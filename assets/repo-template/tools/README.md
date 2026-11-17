# tools/ —— 仓库统一入口

这个仓库的所有工具从这里进。不是"省几条命令"，是**改变默认行为**：
以后新加的工具往 `ws.ps1` 挂，而不是再开一个 `scripts/` 目录。

```powershell
.\tools\ws.ps1 doctor      # 自检：python / git / mise
.\tools\ws.ps1 projects    # 子项目体积、分支、未提交文件数
.\tools\ws.ps1 clean       # 预览可清理的构建产物
.\tools\ws.ps1 clean -Apply   # 真删
```

或用 mise（需要 `mise trust mise.toml`）：

```powershell
mise run doctor
mise run clean
```

## 加新命令

在 `ws.ps1` 的 `switch` 里加一个分支，并同步 `mise.toml` 的 `[tasks]`：

```powershell
'test' { Invoke-Python @('-m', 'pytest', '-q') }
```

## 约定（给 agent 看的）

- 新增能力先进这个入口，不要在仓库里再散落独立脚本。
- `clean` 默认只预览；任何会删除的动作都必须显式 `-Apply`，
  并且在删除前打印将被删的路径。
- 构建产物（`node_modules`、`.venv`、`dist`、`__pycache__`）不进 Git，
  也不在 `clean` 之外手工清理。
- 运行时由 mise 管理，共用 `<ROOT>\cache`，不要在仓库里再放一份独立的包缓存。
