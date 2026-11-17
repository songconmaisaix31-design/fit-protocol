---
name: fit-protocol
version: 1.0.0
description: >-
  把一台机器上散落的开发环境（多个 node/python 副本、各项目的 .venv 与 node_modules、
  npm/pnpm/uv/pip/go 各自的缓存、散落在各个目录的工具脚本）收敛到同一个根目录下，
  用 mise 统一版本、用一份共享缓存放依赖、用一个 tools 入口统一调用，避免同一个东西被
  重复下载；也负责这套目录的搬迁（换机器/换盘）和各 shell 的接线（PowerShell 7 / 5.1 / bash）。
  当用户说「环境太乱」「每个项目装一遍依赖太浪费」「统一一下开发环境」「搞个现代的环境管理工具」
  「C 盘被各种 runtime 撑满了」「多个 node 版本冲突」「tools 命令换个 shell 就没了」
  「把这套环境搬到新机器」，或要给一个仓库做统一的工具入口时使用。Windows 优先，Linux/macOS 思路相同。
metadata:
  openclaw:
    emoji: "🧰"
    requires:
      bins: ["pwsh"]
---

# 环境统一（一个根目录）

散落的环境有三个典型症状：同一个运行时装了好几份、每个项目各自装一遍依赖、
工具脚本到处放没人记得住。这三件事其实是同一个问题：**没有唯一的位置**。

这个 skill 把它们收敛成一个根目录，让"装一次、所有项目共用"成为默认结果，
而不是靠自觉。

## 目标形态

```
<ROOT>                     例如 D:\env 或 ~/.env
├── mise.toml              工具链与环境变量的单一真源
├── mise\                  mise 数据目录（需要装版本时才有内容）
├── cache\                 所有包管理器共用
│   ├── npm\  pnpm\  uv\  pip\  go\{mod,build}\
└── tools\
    ├── tools.ps1          唯一入口：list / which / doctor / clean
    └── README.md
```

仓库侧再叠一层：

```
<repo>
├── mise.toml              继承全局，加仓库特有的 PYTHONPATH / 任务
└── tools\
    ├── ws.ps1             仓库唯一入口
    └── README.md
```

`<ROOT>` 选一个**空间充足、路径不带空格、和项目同盘**的位置。放系统盘会让系统盘
越来越紧；放外置盘会让休眠/断连时全挂。`D:\env` 这种短路径最省事。

## 执行顺序

### 1. 先探测，别先动手

要回答三个问题：现在有几份运行时、缓存各占多少、哪些项目在重复装。

```powershell
# 运行时与包管理器都在哪
foreach ($c in 'node','npm','pnpm','yarn','python','pip','uv','go','java','git','mise','docker') {
  $p = Get-Command $c -ErrorAction SilentlyContinue
  if ($p) { "{0,-8} {1}" -f $c, $p.Source } else { "{0,-8} --" -f $c }
}

# 缓存与虚拟环境的分布（数目比体积更能说明问题）
(Get-ChildItem <repo-root> -Directory -Recurse -Depth 4 -Filter '.venv' -Force -EA SilentlyContinue | Measure-Object).Count
Get-ChildItem $env:LOCALAPPDATA -Directory | Select-Object Name
```

判断依据：同一个语言出现两个以上安装路径，就是重复；`.venv` / `node_modules`
数量远大于项目数，说明每个项目都在自己装。

**体积测量有个坑**：常见的递归统计函数如果用一个 try/catch 包住整个 foreach，
子树里第一个拒绝访问的目录会让整个子树被静默跳过，结果严重偏小
（本机实测把一个 49 GB 的目录统计成了 0.03 GB）。要么按条目逐个 catch，
要么用 `du -sm <dir>/*` 这类外部工具交叉验证，要么最后用
「磁盘可用空间的前后差值」当权威数字。详见 `references/windows-gotchas.md`。

### 2. 建根目录，并把缓存指过去

`scripts/setup-env.ps1` 做完了这一步：建目录、写用户级环境变量、生成 `mise.toml`、
装 `tools.ps1`。默认 `-Root D:\env`，`-WhatIf` 可以只看不改。

```powershell
pwsh -File scripts/setup-env.ps1 -Root D:\env -WhatIf
pwsh -File scripts/setup-env.ps1 -Root D:\env
```

它写的环境变量（用户级，新开终端生效）：

| 变量 | 作用 |
| --- | --- |
| `MISE_DATA_DIR` | 运行时只存这一份 |
| `MISE_GLOBAL_CONFIG_FILE` | 全局配置的位置 |
| `npm_config_cache` / `UV_CACHE_DIR` / `PIP_CACHE_DIR` | 包缓存 |
| `GOMODCACHE` / `GOCACHE` | Go 模块与构建缓存 |

pnpm 不看环境变量，要写进 `~/.npmrc`：

```ini
registry=<你的源>
store-dir=<ROOT>\cache\pnpm
```

**整份重写，不要追加**——原文件如果没有结尾换行，追加会把两条配置粘成一行，
表面上配置成功、实际整份失效。

### 3. 装 mise，但不要重新下载运行时

mise 的价值是"版本可切换 + 数据目录唯一"，不是"再装一份 node"。
机器上已经能跑的运行时直接复用：

```toml
# <ROOT>/mise.toml —— 不写 [tools]，就不接管任何运行时
[env]
MISE_SHARED_ROOT = "D:\\env"
# ... 其余缓存变量

[tasks.doctor]
run = "mise ls --current"
```

要固定版本时再取消 `[tools]` 注释：

```toml
[tools]
node   = "24"
python = "3.13"
```

`mise install` 只会落到 `MISE_DATA_DIR`，所有项目共用。
不要用 `node = "system"` 这种旧写法，新版 mise 会告警
（提示改用 `MISE_DISABLE_TOOLS`），而且语义也不清。

### 4. 装统一入口

`scripts/tools.ps1` 放到 `<ROOT>\tools\tools.ps1`。它自己从脚本位置推断根目录，
所以整个 `<ROOT>` 可以整体搬走。四个子命令：

- `list` 每个工具的名称/版本/真实路径，一屏看完
- `which <name>` 某个工具到底走的哪一份
- `doctor` 缓存位置 + 磁盘 + mise 自检
- `clean` 清共享缓存（可安全重下）

### 5. 接线到 shell

PowerShell 有两个 profile，路径不同，**两个都要写**，否则换个 shell 就失效：

| shell | profile |
| --- | --- |
| pwsh 7 | `~\Documents\PowerShell\profile.ps1` |
| Windows PowerShell 5.1 | `~\Documents\WindowsPowerShell\profile.ps1` |

写之前先看原文件有没有内容——里面很可能是用户自己攒的别名和函数。
**备份 + 合并，不要覆盖**。脚本里用带标记的段落包住自己写的内容，
以后再跑就能幂等替换这一段而不动别人的。

profile 里至少做三件事：把 `<ROOT>\tools` 加进 PATH、定义 `tools` 函数、
（可选）`mise activate` 加共享缓存变量。

### 6. 验证

```powershell
tools list        # 18 个工具都在
tools doctor      # 缓存指向新位置
node --version; python --version; pnpm --version   # 原有工具没被搞坏
```

最后再开一个**全新**终端验证一次——环境变量只对新进程生效，
在旧会话里看到空值是正常的，不要因此去改脚本。

## 仓库侧收敛

仓库里通常散着 `scripts/*.ps1`、`tools/*.sh`、各子项目的构建脚本。
收敛成一个入口，比"整理文件夹"有用得多，因为它改变了默认行为：新脚本会加到入口里，
而不是再开一个目录。

```powershell
# <repo>/tools/ws.ps1
.\tools\ws.ps1 doctor      # 自检
.\tools\ws.ps1 projects    # 项目体积/分支/脏文件
.\tools\ws.ps1 clean       # 预览可清理的构建产物（-Apply 才真删）
```

配套 `<repo>/mise.toml`，用 `{{config_root}}` 写相对路径，任务里就能直接
`python -m <pkg>`，不用先 cd 到子目录：

```toml
[env]
PYTHONPATH = "{{config_root}}/src"
_.path = ["{{config_root}}/.venv/Scripts"]

[tasks.doctor]
run = "python -m mypkg doctor"
```

## 判断这套东西有没有做对

- 新机器上 `mise install` 一次，所有项目能跑 → 做对了
- 删掉某个项目的 `node_modules` 再装，**不产生网络下载** → 缓存真的共享了
- `tools which node` 只指向一个路径 → 没有第二份
- 换 shell（pwsh ↔ 5.1 ↔ cmd）行为一致 → profile 接全了
- 磁盘可用空间在装完依赖后基本不变 → 没有按项目重复落盘

反模式：把 `<ROOT>` 放在系统盘、为"干净"把已有的运行时全删了重装、
把缓存删了但没配共享目录（下次装依赖再次全量下载）、只配一个 shell 的 profile。

## 资源

- `scripts/setup-env.ps1` — 幂等初始化根目录（`-WhatIf` 预览）
- `scripts/tools.ps1` — 环境侧入口（list / which / doctor / clean）
- `bin/fit.mjs` — 注册表侧入口（init / discover / register / agent / list / resolve / probe / serve）
- `adapters/mcp-server.mjs` — MCP 接入面：`fit serve mcp`
- `adapters/http-server.mjs` — HTTP + A2A 接入面：`fit serve http --port 7777`
- `sdk/js`、`sdk/py` — 两种 SDK 接入面
- `assets/repo-template/` — 仓库侧模板，整体拷到仓库根目录即可用：
  - `mise.toml`（改 `[env]` 和 `[tasks]`）
  - `tools/ws.ps1`（改顶部两个常量，再按需加子命令）
  - `tools/README.md`（含给 agent 的约定）
- `references/windows-gotchas.md` — Windows / PowerShell 的实际坑与验证方法
- `docs/PROTOCOLS.md` — 五类端点（env/skill/mcp/acp/a2a）与五种接入面的对照表

## 注册表（v0.2）

环境收敛完之后，机器上还需要一个"谁知道有什么"的地方。`fit` 就是它：

```bash
fit discover --skills ~/.agents/skills --env --save   # 把已有的工具和 skill 收进注册表
fit agent register my-agent --transport mcp           # agent 注册自己
fit list --kind skill                                 # 任何一方都能读
fit probe <name>                                      # 真握手，不是看配置文件
```

同一个注册表有五个入口：CLI、MCP、HTTP/A2A、JS SDK、Python SDK。
能力对等（见 SPEC I10）；HTTP 故意只读。
