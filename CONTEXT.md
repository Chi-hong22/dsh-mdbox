# dsh-mdbox

DeepSeek Harness（DSH）Web 输入框的 Markdown 编辑辅助插件：在原生 textarea 上提供列表续行、缩进与有序列表自动重编号。本上下文记录该插件的领域语言。

## 编辑行为

**有序块**:
同一缩进层级、连续的有序列表行组成的块。块首保留手写编号，块内后续行强制连续递增；各缩进层的块独立记账，嵌套列表结束后回到外层继续递增。
_Avoid_: 编号组、列表段

**自动重编号**:
按键编辑或任意草稿变化后，对全部有序块编号的重排兜底（单次写入、单 undo 事务）；跳过代码围栏内的行。
_Avoid_: 重排、reflow

**缩进重编号**:
Tab 缩进时把操作行的编号重置为 `1.`（保留 `.`/`)` 风格）；Shift+Tab 反缩进只删缩进、编号交由自动重编号并入外层续号。
_Avoid_: 编号重置、重新起号

**列表续行**:
Shift+Enter 在列表行末尾插入下一列表项（有序项递增、无序项复制标记）；空列表项上再按 Shift+Enter 退出列表。
_Avoid_: 自动补全、补标记

## 与 DSH 输入框的边界

**backdrop（背板）**:
DSH Web 输入框的可见文字层，由 React 依据草稿整体渲染（无装饰时是单个文本节点）；textarea 自身文字透明（`color:#0000`），用户看到的文字全部来自背板。背板的子节点归 React fiber 管理，任何 DOM 替换都会与 React 冲突；dsh-mdbox 只做 textarea 的纯文本按键行为，不触碰背板。
_Avoid_: 高亮层、镜像层

**composer（输入卡）**:
DSH Web 输入框整体（`data-composer-card` 卡片），内含背板、textarea、镜像层与工具行；插件通过卡片上的 data 属性定位输入框。
_Avoid_: 输入框（特指 textarea 时）
