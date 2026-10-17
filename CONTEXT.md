# dsh-mdbox

DeepSeek Harness（DSH）Web 输入框的 Markdown 编辑辅助插件：在 Lexical 输入面上提供列表续行、缩进与有序列表自动重编号，并给输入卡加一个纵向展开按钮。本上下文记录该插件的领域语言。

## 编辑行为

**有序块**:
同一缩进层级、连续的有序列表行组成的块。块首保留手写编号，块内后续行强制连续递增；各缩进层的块独立记账，嵌套列表结束后回到外层继续递增。
_Avoid_: 编号组、列表段

**自动重编号**:
按键编辑或任意草稿变化后，对全部有序块编号的重排兜底（单次写入、单 undo 事务）；跳过代码围栏内的行。
_Avoid_: 重排、reflow

**缩进重编号**:
Tab 缩进时把操作行的编号重置为 `1.`（保留 `.`/`)` 风格）；Shift+Tab 反缩进只删缩进、编号交由自动重编号并入外层续号；若被移出的是块首，原缩进层剩余块从 `1.` 重新起号。
_Avoid_: 编号重置、重新起号

**列表续行**:
Shift+Enter 在列表行末尾插入下一列表项（有序项递增、无序项复制标记）；空列表项上再按 Shift+Enter 退出列表。
_Avoid_: 自动补全、补标记

## 与 DSH 输入框的边界

**composer（输入卡）**:
`[data-composer-card]` 那张卡片，结构自上而下是：overlay 锚点 `[data-composer-overlay]`（`position:absolute`、`height:0`，slash / 命令浮层挂这里）→ 可选 accessory 与附件槽 → 输入区 `[data-input-scroll]`（`max-height: var(--dsh-composer-text-max-height)`，`overflow-y:auto`）→ 其内 `.grow` 里的 `[data-composer-input]` 与 `[data-composer-placeholder]` → 工具行。卡片外的 `[data-composer-dock]`（上下文档位、待办面板等）不属于 composer。
_Avoid_: 输入框（单指输入面时）、输入面板

**Lexical 输入面**:
DSH 0.2.0 起输入框是 Lexical 的 `contenteditable`（`[data-composer-input]`，`role="textbox"`、`aria-multiline="true"`），文字由 Lexical 渲染在这个可编辑元素里；0.1.x 那套「透明 textarea + backdrop 背板镜像」已不存在，插件也没有可镜像的第二层文字。编辑器实例挂在输入面根元素的 `__lexicalEditor` 上（Lexical 在 contentEditable 切换时挂载/删除），插件的读写只经这个实例。
_Avoid_: textarea、backdrop、背板、镜像层

**装饰节点（引用 chip）**:
以 Lexical decorator 节点存在的原子内容（引用 chip 等），由 `DecoratorPortals` 用 React portal 渲染进输入面，DOM 归 React 管理。插件只在检测投影里把它折成一个 `U+FFFC`，编辑片段永不切开它。
_Avoid_: 附件节点、内联块

**检测投影（detect 投影）**:
DSH 把输入面文档压成一维文本的口径：段落（顶层块）之间补一个 `\n`，行内换行叶子是 `\n`，装饰节点折叠成一个 `U+FFFC`。插件复刻这套投影得到草稿坐标，按键改动都落在这串文本的偏移上，写回时再映射回 Lexical 的节点与偏移。
_Avoid_: 纯文本、序列化文本、innerText

**展开态**:
输入卡的收起态高度由 DSH 的 `--dsh-composer-text-max-height` 决定；插件在卡片右上角挂一个按钮，展开时把 `[data-input-scroll]` 的高度改写为 `clamp(240px, 52vh, 560px)` 并在卡片上打 `data-mdbox-expanded`，再点一次删掉该属性即收回。按钮是卡片里由插件自管的子元素，不进 `[data-composer-overlay]`——那层里任何可见的绝对定位节点都会被菜单开态判定当成 slash 菜单，从而让出 Tab / Shift+Enter。
_Avoid_: 全屏输入框、弹层编辑器
