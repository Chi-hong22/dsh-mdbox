window.__ModuleLoader__.load({
  id: "@chi-hong22/dsh-mdbox",
  factory: () => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    // dsh-mdbox: 输入框 markdown 编辑辅助(列表续行/缩进/自动重编号 + 分割线)

    // ---- 纯函数工具 ----
    const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/;
    const HR_RE = /^\s*-{3,}\s*$/;
    const MAX_DECORATE = 20000;

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

    let composing = false;
    const onCompStart = () => { composing = true; };
    const onCompEnd = () => { composing = false; };

    // ---- 有序列表自动重编号 ----
    // 规则:同一缩进层、连续的有序行构成一个块;块首编号保持用户所写,后续行强制连续递增;
    // 跳过代码围栏(``` / ~~~)内的行。返回 null 表示无需修改。
    function renumberOrderedLists(draft, caret) {
      const lines = draft.split("\n");
      const deltas = new Array(lines.length).fill(0);
      let fence = false;
      let block = null;
      let changed = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*`{3,}|^\s*~{3,}/.test(line)) { fence = !fence; block = null; continue; }
        if (fence) { block = null; continue; }
        const m = /^(\s*)(\d+)([.)])(\s+)/.exec(line);
        if (m !== null) {
          if (block !== null && block.indent === m[1]) {
            const want = String(block.start + block.count);
            if (m[2] !== want) {
              lines[i] = m[1] + want + m[3] + m[4] + line.slice(m[0].length);
              deltas[i] = want.length - m[2].length;
              changed = true;
            }
            block.count++;
          } else {
            block = { indent: m[1], start: parseInt(m[2], 10), count: 1 };
          }
        } else {
          block = null;
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
          const drop = Math.min(m[1].length, 2);
          if (drop === 0) return;
          e.preventDefault();
          e.stopPropagation();
          res = editWithRenumber(value, value.slice(0, lineStart) + m[1].slice(drop) + value.slice(lineStart + m[1].length), Math.max(lineStart, start - drop));
        } else {
          e.preventDefault();
          e.stopPropagation();
          res = editWithRenumber(value, value.slice(0, lineStart) + "  " + value.slice(lineStart), start + 2);
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
        if (value.length > MAX_DECORATE) return;
        const s = el.selectionStart === null ? value.length : el.selectionStart;
        const t = el.selectionEnd === null ? s : el.selectionEnd;
        const rn = renumberOrderedLists(value, s);
        if (rn === null) return;
        applyEdit(el, rn.text, rn.caret, rn.caret + (t - s));
      });
    }

    // ---- backdrop 原地装饰:仅 --- 分割线 ----
    const bound = new Map();

    function lineHeightOf(backdrop) {
      const lh = getComputedStyle(backdrop).lineHeight;
      return parseFloat(lh) > 0 ? lh : "24px";
    }

    function hrBlock(lineHeight, raw) {
      const el = document.createElement("span");
      el.setAttribute("data-mdbox", "hr");
      el.setAttribute("data-text", raw);
      const rule = "var(--dsw-alias-border-l2,rgba(0,0,0,0.12))";
      const bg = "var(--dsw-specific-input-major,transparent)";
      el.style.cssText = "display:block;height:" + lineHeight + ";background:linear-gradient(to bottom," + bg + " 0," + bg + " 45%," + rule + " 45%," + rule + " 55%," + bg + " 55%," + bg + " 100%);";
      return el;
    }

    function rebuildTextNode(node, fullText, lh) {
      const frag = document.createDocumentFragment();
      let idx = 0;
      while (idx < fullText.length) {
        const nl = fullText.indexOf("\n", idx);
        const core = nl === -1 ? fullText.slice(idx) : fullText.slice(idx, nl);
        if (HR_RE.test(core)) {
          frag.appendChild(hrBlock(lh, core));
        } else if (core !== "") {
          frag.appendChild(document.createTextNode(core));
        }
        idx = nl === -1 ? fullText.length : nl + 1;
        if (nl !== -1 && !HR_RE.test(core)) frag.appendChild(document.createTextNode("\n"));
      }
      node.parentNode.replaceChild(frag, node);
    }

    function wrapBackdrop(backdrop, draftLen) {
      if (draftLen > MAX_DECORATE) return;
      const walker = document.createTreeWalker(backdrop, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let n;
      while ((n = walker.nextNode()) !== null) nodes.push(n);
      const lh = lineHeightOf(backdrop);
      for (const node of nodes) {
        const parent = node.parentElement;
        if (parent === null) continue;
        if (parent.hasAttribute("data-mdbox")) continue;
        if (parent.hasAttribute("data-decoration")) continue;
        const text = node.nodeValue;
        if (text === null || text === "") continue;
        if (!/(?:^|\n)\s*-{3,}\s*(?:\n|$)/.test(text)) continue;
        rebuildTextNode(node, text, lh);
      }
    }

    function unwrapBackdrop(backdrop) {
      const spans = backdrop.querySelectorAll("[data-mdbox]");
      for (const span of spans) {
        span.replaceWith(document.createTextNode(span.getAttribute("data-text") === null ? "---" : span.getAttribute("data-text")));
      }
    }

    function findBackdrop(textarea) {
      const parent = textarea.parentElement;
      if (parent === null) return null;
      const prev = textarea.previousElementSibling;
      if (prev !== null && prev.getAttribute("data-input-backdrop") !== null) return prev;
      return parent.querySelector("[data-input-backdrop]");
    }

    function liveTextarea(backdrop) {
      const next = backdrop.nextElementSibling;
      if (next !== null && next.tagName === "TEXTAREA") return next;
      const parent = backdrop.parentElement;
      return parent === null ? null : parent.querySelector("textarea");
    }

    function sweep() {
      for (const [backdrop, rec] of bound) {
        if (!backdrop.isConnected) {
          rec.mo.disconnect();
          bound.delete(backdrop);
        }
      }
      if (document.body === null) return;
      const list = document.querySelectorAll("[data-composer-card] textarea");
      for (let i = 0; i < list.length; i++) {
        const ta = list[i];
        const backdrop = findBackdrop(ta);
        if (backdrop === null) continue;
        let rec = bound.get(backdrop);
        if (rec === undefined) {
          const mo = new MutationObserver(() => {
            const live = liveTextarea(backdrop);
            wrapBackdrop(backdrop, live === null ? 0 : live.value.length);
          });
          mo.observe(backdrop, { childList: true, characterData: true, subtree: true });
          rec = { mo };
          bound.set(backdrop, rec);
        }
        wrapBackdrop(backdrop, ta.value.length);
      }
    }

    // ---- 插件主体 ----
    function apply(ctx) {
      ctx.effect(() => {
        document.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("input", onInput, true);
        document.addEventListener("compositionstart", onCompStart, true);
        document.addEventListener("compositionend", onCompEnd, true);
        const stopSweep = ctx.interval(sweep, 2000);
        sweep();
        return () => {
          document.removeEventListener("keydown", onKeyDown, true);
          document.removeEventListener("input", onInput, true);
          document.removeEventListener("compositionstart", onCompStart, true);
          document.removeEventListener("compositionend", onCompEnd, true);
          composing = false;
          if (inputRaf !== 0 && typeof cancelAnimationFrame === "function") cancelAnimationFrame(inputRaf);
          inputRaf = 0;
          stopSweep();
          for (const [backdrop, rec] of bound) {
            rec.mo.disconnect();
            unwrapBackdrop(backdrop);
          }
          bound.clear();
        };
      });
    }

    exports.apply = apply;
    exports.inject = ["timer"];
    return module.exports;
  }
});
