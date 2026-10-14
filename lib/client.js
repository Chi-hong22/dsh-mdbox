window.__ModuleLoader__.load({
  id: "@chi-hong22/dsh-mdbox",
  factory: () => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    // dsh-mdbox: 输入框 markdown 编辑辅助(列表续行/缩进/自动重编号)
    //
    // DSH 0.2.0 起 composer 的输入面是 Lexical contenteditable(锚点属性 data-composer-input),
    // 不再是 textarea。草稿读写改走 Lexical 文档:
    //   - 编辑器实例:输入面根元素上的 __lexicalEditor
    //   - 读草稿:复刻 DSH $composerLayout 的 detect 投影(块间一个 "\n",chip 折叠成 1 个字符)
    //   - 写草稿:单次 editor.update 内按"检测偏移 -> Point"落位,只改动需要改的片段,
    //     因此不碰 chip(decorator 节点),也不重建段落。

    const LIST_LINE_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/;
    const LIST_PREFIX_RE = /^(\s*)([-*+]|\d+[.)])(\s)/;
    const ORDERED_LINE_RE = /^(\s*)(\d+)([.)])(\s+)/;
    const ORDERED_PREFIX_RE = /^(\s*)(\d+)([.)])(\s)/;
    const FENCE_RE = /^\s*`{3,}|^\s*~{3,}/;
    const CHIP_CHAR = "\uFFFC";
    const MAX_RENUMBER = 20000;
    const EDIT_TAG = "dsh-mdbox";

    // ---- 纯文本层工具(与 DOM / 编辑器无关) ----

    function nextMarker(marker) {
      if (/^[-*+]$/.test(marker)) return marker;
      const num = parseInt(marker, 10);
      const close = marker.endsWith(")") ? ")" : ".";
      return String(Number.isFinite(num) ? num + 1 : 1) + close;
    }

    // Tab 缩进的标记重写:缩进加 2 空格;有序行编号重置为 1(保留 . / ) 风格)。
    // 返回 null 表示该行不是列表行,不应接管 Tab。
    function applyTabIndent(line_text) {
      const m = LIST_PREFIX_RE.exec(line_text);
      if (m === null) return null;
      const marker = /^\d/.test(m[2]) ? "1" + (m[2].endsWith(")") ? ")" : ".") : m[2];
      const prefix = "  " + m[1] + marker + m[3];
      const old_len = m[1].length + m[2].length + m[3].length;
      return { prefix: prefix, oldPrefixLen: old_len, caretDelta: prefix.length - old_len };
    }

    // Shift+Tab 反缩进后的补丁:若操作行是原缩进层的块首,该层剩余块的第一行编号重置为 1
    // (后续行由兜底重排递增)。返回 draft 坐标下的编辑片段;不适用时返回 null。
    function restartNestedAfterOutdent(draft, op_line_start, old_indent) {
      const nl = draft.indexOf("\n", op_line_start);
      if (nl === -1) return null;
      const next_start = nl + 1;
      const nl2 = draft.indexOf("\n", next_start);
      const next_end = nl2 === -1 ? draft.length : nl2;
      const next_line = draft.slice(next_start, next_end);
      const m = ORDERED_PREFIX_RE.exec(next_line);
      if (m === null || m[1] !== old_indent) return null;
      if (m[2] === "1") return null;
      const at = next_start + m[1].length;
      return { start: at, end: at + m[2].length, text: "1" };
    }

    // ---- 有序列表自动重编号 ----
    // 规则:同一缩进层、连续的有序行构成一个块;块首编号保持用户所写,后续行强制连续递增。
    // 各缩进层的块独立记账,嵌套列表结束后回到外层能继续递增;普通行打断所有层;
    // 跳过代码围栏(``` / ~~~)内的行。
    // 返回 { edits, caret }:edits 是 draft 坐标下只改编号数字的片段(升序、互不重叠),
    // caret 是重排后的插入点。返回 null 表示无需修改。
    function renumberOrderedLists(draft, caret) {
      const lines = draft.split("\n");
      const deltas = [];
      const edits = [];
      const blocks = new Map();
      let line_start = 0;
      let fence = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let delta = 0;
        if (FENCE_RE.test(line)) {
          fence = !fence;
          blocks.clear();
        } else if (fence) {
          blocks.clear();
        } else {
          const m = ORDERED_LINE_RE.exec(line);
          if (m !== null) {
            const blk = blocks.get(m[1]);
            if (blk !== undefined) {
              const want = String(blk.start + blk.count);
              if (m[2] !== want) {
                const at = line_start + m[1].length;
                edits.push({ start: at, end: at + m[2].length, text: want });
                delta = want.length - m[2].length;
              }
              blk.count++;
            } else {
              blocks.set(m[1], { start: parseInt(m[2], 10), count: 1 });
            }
          } else {
            blocks.clear();
          }
        }
        deltas.push(delta);
        line_start += line.length + 1;
      }
      if (edits.length === 0) return null;
      let line_idx = lines.length - 1;
      let acc = 0;
      for (let i = 0; i < lines.length; i++) {
        if (caret <= acc + lines[i].length) { line_idx = i; break; }
        acc += lines[i].length + 1;
      }
      let shift = 0;
      for (let i = 0; i <= line_idx; i++) shift += deltas[i];
      return { edits: edits, caret: caret + shift };
    }

    // 把"局部编辑(原始坐标)+ 可选补丁(局部编辑后坐标)+ 兜底重排"合并成一组原始坐标下
    // 互不重叠的 edits,并给出最终文本里的插入点。
    // 重排跑在编辑后的文本上(缩进/续行会改变列表块的边界),结果再映射回原始坐标:
    // 与局部编辑或补丁重叠的重排编辑被丢弃(那处文本已经写好),其长度变化从 caret 里扣掉。
    function finishPlan(text, local_edit, local_caret, patch) {
      const delta = local_edit.text.length - (local_edit.end - local_edit.start);
      let mid = text.slice(0, local_edit.start) + local_edit.text + text.slice(local_edit.end);
      let mid_caret = local_caret;
      const edits = [local_edit];
      let patch_delta = 0;
      if (patch !== null && patch !== undefined) {
        patch_delta = patch.text.length - (patch.end - patch.start);
        edits.push({ start: patch.start - delta, end: patch.end - delta, text: patch.text });
        if (mid_caret >= patch.end) mid_caret += patch_delta;
        else if (mid_caret > patch.start) mid_caret = patch.start + patch.text.length;
        mid = mid.slice(0, patch.start) + patch.text + mid.slice(patch.end);
      }
      const rn = renumberOrderedLists(mid, mid_caret);
      if (rn !== null) {
        const mid_start = local_edit.start;
        const mid_end = local_edit.start + local_edit.text.length;
        let dropped = 0;
        for (const e of rn.edits) {
          let s = e.start;
          let en = e.end;
          if (patch !== null && patch !== undefined) {
            if (s >= patch.end) { s -= patch_delta; en -= patch_delta; }
            else if (en > patch.start) {
              if (s < mid_caret) dropped += e.text.length - (en - s);
              continue;
            }
          }
          if (en <= mid_start) edits.push({ start: s, end: en, text: e.text });
          else if (s >= mid_end) edits.push({ start: s - delta, end: en - delta, text: e.text });
          else if (s < mid_caret) dropped += e.text.length - (en - s);
        }
        mid_caret = rn.caret - dropped;
      }
      // 起点相同时短片段先落(倒序执行时长片段先改),避免零宽插入吃掉后面的重排坐标。
      edits.sort((a, b) => a.start - b.start || a.end - b.end);
      return { edits: edits, caret: mid_caret };
    }

    // Shift+Enter 列表续行:空列表项退出列表,否则插入下一标记的新行。
    function planContinuation(text, caret) {
      const line_start = text.lastIndexOf("\n", caret - 1) + 1;
      const m = LIST_LINE_RE.exec(text.slice(line_start, caret));
      if (m === null) return null;
      if (m[4].trim() === "") {
        return finishPlan(text, { start: line_start, end: caret, text: m[1] }, line_start + m[1].length, null);
      }
      const cont = m[1] + nextMarker(m[2]) + " ";
      return finishPlan(text, { start: caret, end: caret, text: "\n" + cont }, caret + 1 + cont.length, null);
    }

    // Tab / Shift+Tab:按 2 空格一层缩进或反缩进列表行。
    function planIndent(text, caret, outdent) {
      const line_start = text.lastIndexOf("\n", caret - 1) + 1;
      const nl = text.indexOf("\n", caret);
      const line_end = nl === -1 ? text.length : nl;
      const line_text = text.slice(line_start, line_end);
      const m = LIST_PREFIX_RE.exec(line_text);
      if (m === null) return null;
      if (outdent) {
        const drop = Math.min(m[1].length, 2);
        if (drop === 0) return null;
        const local_edit = { start: line_start, end: line_start + drop, text: "" };
        const mid = text.slice(0, line_start) + m[1].slice(drop) + text.slice(line_start + m[1].length);
        const patch = restartNestedAfterOutdent(mid, line_start, m[1]);
        return finishPlan(text, local_edit, Math.max(line_start, caret - drop), patch);
      }
      const ind = applyTabIndent(line_text);
      if (ind === null) return null;
      const local_edit = { start: line_start, end: line_start + ind.oldPrefixLen, text: ind.prefix };
      return finishPlan(text, local_edit, caret + ind.caretDelta, null);
    }

    // ---- Lexical 文档投影 ----
    // 复刻 DSH $composerLayout 的 detect 投影:叶子取自身文本,行内换行是 "\n",
    // chip 等 decorator 折叠成一个 U+FFFC,顶层块之间补一个 "\n"。

    function nodeText(node) {
      const type = node.getType();
      if (type === "linebreak") return "\n";
      if (type === "text") return node.getTextContent();
      if (typeof node.getChildren === "function") {
        let out = "";
        for (const kid of node.getChildren()) out += nodeText(kid);
        return out;
      }
      return CHIP_CHAR;
    }

    function projectDraft(root_node) {
      const blocks = root_node.getChildren();
      const parts = [];
      for (let i = 0; i < blocks.length; i++) parts.push(nodeText(blocks[i]));
      return parts.join("\n");
    }

    // 检测偏移 -> Point。落在 chip / linebreak 等非文本叶子上时吸附到它的前边界或后边界,
    // 保证编辑片段永远不会切开 decorator 节点。
    function offsetToPoint(root_node, target) {
      const blocks = root_node.getChildren();
      if (blocks.length === 0) return { node: root_node, offset: 0, type: "element" };
      let acc = 0;
      for (let i = 0; i < blocks.length; i++) {
        if (i > 0) {
          if (target < acc + 1) return endPointOf(blocks[i - 1]);
          acc += 1;
        }
        const len = nodeText(blocks[i]).length;
        if (target <= acc + len) return descendPoint(blocks[i], target - acc);
        acc += len;
      }
      return endPointOf(blocks[blocks.length - 1]);
    }

    function descendPoint(node, rel) {
      const kids = typeof node.getChildren === "function" ? node.getChildren() : null;
      if (kids === null) {
        return { node: node, offset: Math.min(Math.max(rel, 0), nodeText(node).length), type: "text" };
      }
      if (kids.length === 0) return { node: node, offset: 0, type: "element" };
      let acc = 0;
      for (let i = 0; i < kids.length; i++) {
        const kid = kids[i];
        const len = nodeText(kid).length;
        if (len === 0) continue;
        if (rel <= acc + len) {
          // chip / linebreak 等非文本叶子:边界吸附到它的前或后,绝不落到内部。
          if (kid.getType() !== "text") return { node: node, offset: rel <= acc ? i : i + 1, type: "element" };
          return descendPoint(kid, rel - acc);
        }
        acc += len;
      }
      return { node: node, offset: kids.length, type: "element" };
    }

    function endPointOf(node) {
      const kids = typeof node.getChildren === "function" ? node.getChildren() : null;
      if (kids === null) return { node: node, offset: nodeText(node).length, type: "text" };
      if (kids.length === 0) return { node: node, offset: 0, type: "element" };
      const last = kids[kids.length - 1];
      if (last.getType() !== "text") return { node: node, offset: kids.length, type: "element" };
      return endPointOf(last);
    }

    // Point -> 检测偏移(offsetToPoint 的逆)。
    function offsetOfPoint(root_node, point) {
      const node = point.getNode();
      if (node === null || node === undefined) return null;
      const blocks = root_node.getChildren();
      if (node === root_node) {
        const k = Math.min(Math.max(point.offset, 0), blocks.length);
        let off = k;
        for (let i = 0; i < k; i++) off += nodeText(blocks[i]).length;
        return off;
      }
      const path = [];
      let cur = node;
      while (cur !== null && cur !== root_node) {
        path.push(cur);
        cur = cur.getParent();
      }
      if (cur !== root_node) return null;
      path.reverse();
      const block_idx = blocks.indexOf(path[0]);
      if (block_idx < 0) return null;
      let off = block_idx;
      let parent = root_node;
      for (let d = 0; d < path.length; d++) {
        const child = path[d];
        const kids = parent.getChildren();
        const idx = kids.indexOf(child);
        if (idx < 0) return null;
        for (let i = 0; i < idx; i++) off += nodeText(kids[i]).length;
        if (d === path.length - 1) {
          const sub = typeof child.getChildren === "function" ? child.getChildren() : null;
          if (sub === null) {
            off += point.offset;
          } else {
            const k = Math.min(Math.max(point.offset, 0), sub.length);
            for (let i = 0; i < k; i++) off += nodeText(sub[i]).length;
          }
        }
        parent = child;
      }
      return off;
    }

    // ---- 写入 ----

    function insertMultiline(sel, text) {
      if (text === "") return;
      const parts = text.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) sel.insertLineBreak(false);
        if (parts[i] !== "") sel.insertText(parts[i]);
      }
    }

    // 按升序传入、倒序落地:后面的片段先改,前面片段的检测坐标仍然有效。
    function applyPlan(root_node, sel, plan) {
      const edits = plan.edits;
      for (let i = edits.length - 1; i >= 0; i--) {
        const ed = edits[i];
        const a = offsetToPoint(root_node, ed.start);
        const b = offsetToPoint(root_node, ed.end);
        if (a === null || b === null) continue;
        sel.anchor.set(a.node.getKey(), a.offset, a.type);
        sel.focus.set(b.node.getKey(), b.offset, b.type);
        if (ed.end > ed.start) sel.removeText();
        insertMultiline(sel, ed.text);
      }
      const c = offsetToPoint(root_node, plan.caret);
      if (c === null) return;
      sel.anchor.set(c.node.getKey(), c.offset, c.type);
      const end = plan.selEnd === undefined ? plan.caret : plan.selEnd;
      const d = end === plan.caret ? c : offsetToPoint(root_node, end);
      if (d === null) sel.focus.set(c.node.getKey(), c.offset, c.type);
      else sel.focus.set(d.node.getKey(), d.offset, d.type);
    }

    // ---- DOM / 编辑器接入 ----

    function composerInput(el) {
      if (el === null || el === undefined || el.nodeType !== 1) return null;
      if (typeof el.matches === "function" && el.matches("[data-composer-input]")) return el;
      return typeof el.closest === "function" ? el.closest("[data-composer-input]") : null;
    }

    function getEditor(root_el) {
      const editor = root_el.__lexicalEditor;
      if (editor === null || editor === undefined) return null;
      return typeof editor.update === "function" ? editor : null;
    }

    // 只在 editor.update() 回调内调用:此时 _pendingEditorState 一定可写,
    // 且 Lexical 已把 DOM 选区同步进来。
    function pendingRoot(editor) {
      const state = editor._pendingEditorState;
      if (state === null || state === undefined) return undefined;
      return state._nodeMap.get("root");
    }

    function pendingSelection(editor) {
      const state = editor._pendingEditorState;
      if (state === null || state === undefined) return null;
      const sel = state._selection;
      if (sel === null || sel === undefined) return null;
      return typeof sel.isCollapsed === "function" ? sel : null;
    }

    function runKeyEdit(editor, key, outdent) {
      let handled = false;
      editor.update(() => {
        const root_node = pendingRoot(editor);
        const sel = pendingSelection(editor);
        if (root_node === undefined || sel === null) return;
        if (!sel.isCollapsed()) return;
        const text = projectDraft(root_node);
        if (text.length > MAX_RENUMBER) return;
        const caret = offsetOfPoint(root_node, sel.anchor);
        if (caret === null) return;
        const plan = key === "Enter" ? planContinuation(text, caret) : planIndent(text, caret, outdent);
        if (plan === null) return;
        applyPlan(root_node, sel, plan);
        handled = true;
      }, { tag: EDIT_TAG });
      return handled;
    }

    // 兜底重排:任何草稿变化后按 rAF 节流跑一次;重排后无变化自动收敛。
    let renumber_raf = 0;

    function runFallbackRenumber(editor) {
      editor.update(() => {
        const root_node = pendingRoot(editor);
        const sel = pendingSelection(editor);
        if (root_node === undefined || sel === null) return;
        const text = projectDraft(root_node);
        if (text.length > MAX_RENUMBER) return;
        const caret = offsetOfPoint(root_node, sel.anchor);
        if (caret === null) return;
        const focus = offsetOfPoint(root_node, sel.focus);
        const rn = renumberOrderedLists(text, caret);
        if (rn === null) return;
        const sel_end = focus === null || focus === caret ? rn.caret : rn.caret + (focus - caret);
        applyPlan(root_node, sel, { edits: rn.edits, caret: rn.caret, selEnd: sel_end });
      }, { tag: EDIT_TAG });
    }

    const watched_roots = new WeakMap();
    const active_watchers = new Set();

    function watchComposer(root_el, editor) {
      if (watched_roots.has(root_el)) return;
      if (typeof editor.registerUpdateListener !== "function") return;
      const unlisten = editor.registerUpdateListener((payload) => {
        if (payload !== null && payload !== undefined && payload.tags !== undefined && payload.tags.has(EDIT_TAG)) return;
        if (renumber_raf !== 0) return;
        renumber_raf = requestAnimationFrame(() => {
          renumber_raf = 0;
          if (!root_el.isConnected || composing) return;
          runFallbackRenumber(editor);
        });
      });
      watched_roots.set(root_el, unlisten);
      active_watchers.add(unlisten);
    }

    // slash / 命令菜单开着时让出 Tab 与 Shift+Enter。菜单渲染在卡片的 overlay 锚点里,
    // 该锚点是 absolute + height:0 的零高容器,开态才出现可见的浮层。
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

    let composing = false;
    const onCompStart = () => { composing = true; };
    const onCompEnd = () => { composing = false; };

    function onKeyDown(e) {
      const root_el = composerInput(e.target);
      if (root_el === null) return;
      if (root_el.isContentEditable !== true) return;
      if (composing || e.isComposing || e.keyCode === 229) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const is_enter = e.key === "Enter" && e.shiftKey;
      const is_tab = e.key === "Tab";
      if (!is_enter && !is_tab) return;
      const card = typeof root_el.closest === "function" ? root_el.closest("[data-composer-card]") : null;
      if (card === null) return;
      if (menuLayerOpen(card)) return;
      const editor = getEditor(root_el);
      if (editor === null) return;
      watchComposer(root_el, editor);
      if (!runKeyEdit(editor, is_enter ? "Enter" : "Tab", e.shiftKey)) return;
      e.preventDefault();
      e.stopPropagation();
    }

    function onFocusIn(e) {
      const root_el = composerInput(e.target);
      if (root_el === null) return;
      const editor = getEditor(root_el);
      if (editor === null) return;
      watchComposer(root_el, editor);
    }

    // ---- 插件主体 ----
    function apply(ctx) {
      ctx.effect(() => {
        document.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("focusin", onFocusIn, true);
        document.addEventListener("compositionstart", onCompStart, true);
        document.addEventListener("compositionend", onCompEnd, true);
        return () => {
          document.removeEventListener("keydown", onKeyDown, true);
          document.removeEventListener("focusin", onFocusIn, true);
          document.removeEventListener("compositionstart", onCompStart, true);
          document.removeEventListener("compositionend", onCompEnd, true);
          composing = false;
          for (const unlisten of active_watchers) {
            try { unlisten(); } catch (err) { /* 编辑器已销毁 */ }
          }
          active_watchers.clear();
          if (renumber_raf !== 0 && typeof cancelAnimationFrame === "function") cancelAnimationFrame(renumber_raf);
          renumber_raf = 0;
        };
      });
    }

    exports.apply = apply;
    return module.exports;
  }
});
