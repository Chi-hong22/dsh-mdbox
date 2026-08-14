# dsh-mdbox

DeepSeek Harness (DSH) Web 输入框的 Markdown 编辑辅助插件。

## Overview

DSH 的输入框是一个纯文本 textarea：写列表要自己敲标记，改编号要自己数。这个插件补上几个编辑器里常见的小动作：`Shift+Enter` 在列表行续行（有序列表自动递增），`Tab` 缩进列表项（有序行编号重置为 `1.`），`Shift+Tab` 反缩进（编号自动并入外层继续）。发出去的内容还是纯文本，`Enter` 还是发送，什么都不变。

如果你经常在对话里写清单、步骤和带缩进的提纲，会用到它。

## Compatibility

在 `@deepseek-ai/dsh-*` 0.1.0-rc.6（npx 部署快照）上验证过，最后验证日期 2026-08-13。

插件依赖输入框卡片上的 `data-composer-card` 属性定位输入框。DSH 大版本如果调整输入框 DOM，可能需要跟着改。

纯浏览器端插件，没有宿主半部，没有服务注入。插件不触碰 DSH 的 backdrop 渲染层（输入框可见文字由该层渲染），只做纯文本按键行为。

## Install

装进官方 web profile（自带 dsh-base + dsh-web-app 两层）：

```powershell
dsh plugin --profile web add github:chi-hong22/dsh-mdbox
# 或本地 checkout：
dsh plugin --profile web add D:/path/to/dsh-mdbox
```

仓库包含构建产物（`lib/` 已提交，纯 JS 没有构建步骤），安装后无需另外构建。`dsh plugin add` 会写入依赖并把本包加进 profile 的 bundles 列表，挂载行来自本包自带的 `cordis.patch.yml`，不需要手动改任何 profile 文件。

验证安装：

```powershell
dsh --profile web --dump-config | Select-String ui-mdbox
```

输出里有下面几行就是装上了：

```yaml
# == @chi-hong22/dsh-mdbox
- id: ui-mdbox
  name: '@chi-hong22/dsh-mdbox'
```

重启 DSH，插件出现在 设置 → 插件 里。

手动安装只留给旧版本或调试：把本包作为 workspace/link 依赖装上，再在 profile 的 `cordis.patch.yml` 里手写一行 `insert: [{ id: ui-mdbox, name: '@chi-hong22/dsh-mdbox' }]`。别和 bundle 通道并用，同一行挂两次会双重加载。

## Uninstall

```powershell
dsh plugin --profile web remove @chi-hong22/dsh-mdbox
```

执行后重启 DSH 生效。

如果你当时是手动安装的（旧路径）：删掉 profile `cordis.patch.yml` 里的 `ui-mdbox` 行、`package.json` 里的依赖、`node_modules` 里的链接，然后重启。

插件不写磁盘，删掉就是删干净了。升级：`link:` 安装的直接更新仓库目录内容，重启生效；npm 安装的用 `dsh plugin --profile web add @chi-hong22/dsh-mdbox@<version>`。

## Quick start

没有插件级配置项。

```text
- 第一项            # Shift+Enter → 续行 "- "
  1. 子步骤        # Tab 缩进（编号重置为 1.）；Shift+Enter → "2. "；Shift+Tab 反缩进（并入外层续号）
```

自动重编号：已有 `1. a` / `2. b` 两行，在 `1. a` 行尾按 `Shift+Enter` 插入新行：

```text
1. a
2.          ← 新插入的空列表项
3. b        ← 原 2. b 自动变为 3. b
```

空列表项上再按 `Shift+Enter` 退出列表（删掉行首标记）。普通行 `Enter` 发送，`Shift+Enter` 换行，`Ctrl+Enter` 强制发送。

缩进与反缩进（光标在列表行内按 `Tab` / `Shift+Tab`）：

- `Tab`：整行缩进 2 空格；有序行编号重置为 `1.`（保留 `.` / `)` 风格），同层后续行自动递增；
- `Shift+Tab`：删掉最多 2 空格缩进；有序行编号自动并入外层块继续（外层最大编号 +1）；
- 无序行缩进/反缩进只动缩进，标记不变。

## Configuration

没有配置项，也没有环境变量。行为常量在 `lib/client.js` 顶部：

- 列表标记：`-` `*` `+`、`1.` `1)`。有序块内编号强制连续，块首保持你写的起始值；各缩进层的块独立记账，嵌套列表结束后回到外层继续递增；
- 缩进宽度：2 空格（Tab 缩进时有序行编号重置为 `1.`，Shift+Tab 反缩进后编号并入外层续号）；
- `MAX_RENUMBER = 20000`：草稿超过 20000 字符后跳过兜底重排，按键行为不受影响；
- 自动重编号跳过代码围栏（``` / ~~~）里的行。

## Permissions & data

不碰文件、网络、凭据和用户数据；没有宿主半部，不上传也不存储任何内容。只读当前会话输入框的草稿文本（浏览器内存内），只做按键行为，不修改输入框之外的任何 DOM。副作用都挂在 Cordis fiber 上，插件停用即还原。

## Troubleshooting

| 现象 | 排查 |
| --- | --- |
| 重启后插件列表没有 dsh-mdbox | 检查 patch 行 `name` 与包 `name` 是否一致、`node_modules` 链接是否指向有效目录、YAML 缩进是否正确 |
| 插件在列表但功能不生效 | 确认焦点在输入框；IME 组合输入期间插件会主动让位（先确认候选词上屏）；打开浏览器控制台看 `dsh-mdbox` 相关报错 |
| 想回滚 | 删除 patch 条目并重启；改动都在 profile 目录，插件没有持久化数据 |

日志：插件不写日志文件；运行期错误在浏览器开发者工具 Console 里。

## Development

没有构建步骤：直接改 `lib/client.js`（浏览器半部）和 `lib/index.js`（宿主半部空实现），重启 DSH 生效。

```
├── package.json       # 包声明（dsh.bundle.patch + dsh.client；peerDeps 仅 cordis）
├── cordis.patch.yml   # bundle patch：insert ui-mdbox 行（官方挂载通道）
├── LICENSE
└── lib
    ├── index.js     # 宿主半部（空实现，纯 UI 插件的 Loader 约定）
    └── client.js    # 浏览器半部（__ModuleLoader__ 模块格式）
```

手动验证清单：列表续行/递增、中间插入后自动重编号、空项退出、Tab 缩进（编号重置为 1.）/ Shift+Tab 反缩进（并入外层续号）、IME 组合输入让位、`Ctrl+Z` 撤销。

纯函数回归验证（Node，不需要浏览器）：

```powershell
node .scratch/editor-fixes/verify.mjs
```

发布到 npm 时，把 `name` 换成你自己有权控制的 scope，不要占用 `@deepseek-ai/*` 官方保留命名空间；并在 package.json 补上 `repository` 字段。

## License & security

许可证：MIT（见 LICENSE）。

安全问题走 GitHub Issue；涉及未公开细节的不要写进公开 issue，先通过仓库所有者的 GitHub 主页私信联系。
