window.__ModuleLoader__.load({
  id: "@chi-hong22/dsh-mdbox",
  factory: () => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    // dsh-mdbox: 输入框 markdown 编辑辅助(列表续行/缩进/自动重编号)

    // ---- 纯函数工具 ----
    const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/;
    const MAX_RENUMBER = 20000;

    const valueSetter = (() => {
      const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
      return desc !== undefined && desc.set !== undefined ? desc.set : null;
    })();

    function applyEdit(el, nextValue, selStart, selEnd) {
      if (valueSetter !== null) valueSetter.call(el, nextValue);
      else el.value = nextValue;
      try { el.setSelectionRange(selStart, selEnd === undefined ? selStart : selEnd); } catch (err) { /* 忽略 */ }
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function menuLayerOpen(card) {
      const anchor = card.firstElementChild;
      if (anchor === null) return false;
      if (getComputedStyle(anchor).position !== "absolute") return false;
      for (const child of anchor.querySelectorAll("*")) {
        if (child.offsetWidth === 0 && child.offsetHeight === 0) continue;
        const pos = getComputedStyle(child).position;
        if (pos === "absolute" || pos === "fixed") return true;
      }
      return false;
    }

    function nextMarker(marker) {
      if (/^[-*+]$/.test(marker)) return marker;
      const num = parseInt(marker, 10);
      const close = marker.endsWith(")") ? ")" : ".";
      return String(Number.isFinite(num) ? num + 1 : 1) + close;
    }

    function isComposerTextarea(el) {
      if (el === null || el.nodeType !== 1 || el.tagName !== "TEXTAREA") return false;
      return el.closest("[data-composer-card]") !== null;
    }

    // Tab 缩进的行重写(纯文本层):缩进加 2 空格;有序行编号重置为 1(保留 . / ) 风格)。
    // 返回 null 表示该行不是列表行,不应接管 Tab。
    function applyTabIndent(lineText) {
      const m = /^(\s*)([-*+]|\d+[.)])(\s)/.exec(lineText);
      if (m === null) return null;
      let marker;
      if (/^\d/.test(m[2])) marker = "1" + (m[2].endsWith(")") ? ")" : ".");
      else marker = m[2];
      const prefix = "  " + m[1] + marker + m[3];
      return { text: prefix + lineText.slice(m[0].length), caretDelta: prefix.length - m[0].length };
    }

    // Shift+Tab 反缩进后的行重写:若操作行是原缩进层的块首,该层剩余块的第一行编号重置为 1
    // (后续行由兜底重排递增)。操作行之后没有同层有序行时返回 null。
    function restartNestedAfterOutdent(draft, opLineStart, oldIndent) {
      const nl = draft.indexOf("\n", opLineStart);
      if (nl === -1) return null;
      const nextLineStart = nl + 1;
      const nl2 = draft.indexOf("\n", nextLineStart);
      const nextLineEnd = nl2 === -1 ? draft.length : nl2;
      const nextLine = draft.slice(nextLineStart, nextLineEnd);
      const m = /^(\s*)(\d+)([.)])(\s)/.exec(nextLine);
      if (m === null || m[1] !== oldIndent) return null;
      if (m[2] === "1") return null;
      return {
        text: draft.slice(0, nextLineStart) + m[1] + "1" + m[3] + m[4] + nextLine.slice(m[0].length) + draft.slice(nextLineEnd),
      };
    }

    let composing = false;
    const onCompStart = () => { composing = true; };
    const onCompEnd = () => { composing = false; };

    // ---- 有序列表自动重编号 ----
    // 规则:同一缩进层、连续的有序行构成一个块;块首编号保持用户所写,后续行强制连续递增。
    // 各缩进层的块独立记账,嵌套列表结束后回到外层能继续递增;普通行打断所有层;
    // 跳过代码围栏(``` / ~~~)内的行。返回 null 表示无需修改。
    function renumberOrderedLists(draft, caret) {
      const lines = draft.split("\n");
      const deltas = new Array(lines.length).fill(0);
      let fence = false;
      const blocks = new Map();
      let changed = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*`{3,}|^\s*~{3,}/.test(line)) { fence = !fence; blocks.clear(); continue; }
        if (fence) { blocks.clear(); continue; }
        const m = /^(\s*)(\d+)([.)])(\s+)/.exec(line);
        if (m !== null) {
          const blk = blocks.get(m[1]);
          if (blk !== undefined) {
            const want = String(blk.start + blk.count);
            if (m[2] !== want) {
              lines[i] = m[1] + want + m[3] + m[4] + line.slice(m[0].length);
              deltas[i] = want.length - m[2].length;
              changed = true;
            }
            blk.count++;
          } else {
            blocks.set(m[1], { start: parseInt(m[2], 10), count: 1 });
          }
        } else {
          blocks.clear();
        }
      }
      if (!changed) return null;
      let lineIdx = lines.length - 1;
      let acc = 0;
      for (let i = 0; i < lines.length; i++) {
        if (caret <= acc + lines[i].length) { lineIdx = i; break; }
        acc += lines[i].length + 1;
      }
      let shift = 0;
      for (let i = 0; i <= lineIdx; i++) shift += deltas[i];
      return { text: lines.join("\n"), caret: caret + shift };
    }

    // 编辑后融合重排为单次写入(单 undo 事务);返回 { text, caret }
    function editWithRenumber(value, next, caret) {
      const rn = renumberOrderedLists(next, caret);
      if (rn !== null) return { text: rn.text, caret: rn.caret };
      return { text: next, caret };
    }

    // ---- 键盘接管:Shift+Enter 列表续行 + Tab 缩进 ----
    function onKeyDown(e) {
      const el = e.target;
      if (!isComposerTextarea(el)) return;
      const card = el.closest("[data-composer-card]");
      if (el.readOnly || el.disabled) return;
      if (composing || e.isComposing || e.keyCode === 229) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const value = el.value;
      const start = el.selectionStart === null ? value.length : el.selectionStart;
      const end = el.selectionEnd === null ? start : el.selectionEnd;

      if (e.key === "Enter" && e.shiftKey) {
        if (menuLayerOpen(card)) return;
        if (start !== end) return;
        const lineStart = value.lastIndexOf("\n", start - 1) + 1;
        const lineText = value.slice(lineStart, start);
        const m = LIST_RE.exec(lineText);
        if (m === null) return;
        e.preventDefault();
        e.stopPropagation();
        const indent = m[1];
        let res;
        if (m[4].trim() === "") {
          res = editWithRenumber(value, value.slice(0, lineStart) + indent + value.slice(start), lineStart + indent.length);
        } else {
          const cont = indent + nextMarker(m[2]) + " ";
          res = editWithRenumber(value, value.slice(0, start) + "\n" + cont + value.slice(start), start + 1 + cont.length);
        }
        applyEdit(el, res.text, res.caret);
        return;
      }

      if (e.key === "Tab") {
        if (menuLayerOpen(card)) return;
        if (start !== end) return;
        const lineStart = value.lastIndexOf("\n", start - 1) + 1;
        const lineEndIdx = value.indexOf("\n", start);
        const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
        const lineText = value.slice(lineStart, lineEnd);
        const m = /^(\s*)([-*+]|\d+[.)])(\s)/.exec(lineText);
        if (m === null) return;
        let res;
        if (e.shiftKey) {
          // 反缩进只删缩进、编号不变;兜底重排会把它并入外层块强制递增(即"外层最大编号+1")。
          // 若被移出的是块首,其原缩进层剩余块从 1. 重新起号。
          const drop = Math.min(m[1].length, 2);
          if (drop === 0) return;
          e.preventDefault();
          e.stopPropagation();
          let next = value.slice(0, lineStart) + m[1].slice(drop) + value.slice(lineStart + m[1].length);
          const restarted = restartNestedAfterOutdent(next, lineStart, m[1]);
          if (restarted !== null) next = restarted.text;
          res = editWithRenumber(value, next, Math.max(lineStart, start - drop));
        } else {
          const ind = applyTabIndent(lineText);
          e.preventDefault();
          e.stopPropagation();
          res = editWithRenumber(value, value.slice(0, lineStart) + ind.text + value.slice(lineEnd), start + ind.caretDelta);
        }
        applyEdit(el, res.text, res.caret);
        return;
      }
    }

    // 手动插入/任意草稿变化的兜底重排(rAF 节流;重排后无变化自动收敛)
    let inputRaf = 0;
    function onInput(e) {
      const el = e.target;
      if (!isComposerTextarea(el)) return;
      if (composing || e.isComposing) return;
      if (inputRaf !== 0) return;
      inputRaf = requestAnimationFrame(() => {
        inputRaf = 0;
        if (!el.isConnected) return;
        const value = el.value;
        if (value.length > MAX_RENUMBER) return;
        const s = el.selectionStart === null ? value.length : el.selectionStart;
        const t = el.selectionEnd === null ? s : el.selectionEnd;
        const rn = renumberOrderedLists(value, s);
        if (rn === null) return;
        applyEdit(el, rn.text, rn.caret, rn.caret + (t - s));
      });
    }

    // ---- 插件主体 ----
    function apply(ctx) {
      ctx.effect(() => {
        document.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("input", onInput, true);
        document.addEventListener("compositionstart", onCompStart, true);
        document.addEventListener("compositionend", onCompEnd, true);
        return () => {
          document.removeEventListener("keydown", onKeyDown, true);
          document.removeEventListener("input", onInput, true);
          document.removeEventListener("compositionstart", onCompStart, true);
          document.removeEventListener("compositionend", onCompEnd, true);
          composing = false;
          if (inputRaf !== 0 && typeof cancelAnimationFrame === "function") cancelAnimationFrame(inputRaf);
          inputRaf = 0;
        };
      });
    }

    exports.apply = apply;
    return module.exports;
  }
});
