# Windows / PowerShell 的实际坑

这份文档记录的是**亲手踩过、并且能复现**的问题，不是泛泛的最佳实践。
遇到"配置写了但不生效""数字对不上""脚本突然语法错误"时先看这里。

## 1. PowerShell 5.1 按 ANSI 读 .ps1，中文注释会打断解析

**现象**：脚本里带中文，用 `powershell -File x.ps1` 跑，报
`Unexpected token ... The string is missing the terminator`，报的行号往往在中文注释附近。
用 pwsh 7 跑同样文件却正常。

**原因**：Windows PowerShell 5.1 在文件没有 BOM 时按系统 ANSI 代码页解码，
UTF-8 的中文字节被解成乱码，乱码里恰好出现引号/反引号就把语句截断了。

**做法**：所有 .ps1 写成 **UTF-8 with BOM**。

```powershell
$p = 'x.ps1'
$text = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($p))
[System.IO.File]::WriteAllText($p, $text, (New-Object System.Text.UTF8Encoding($true)))
```

改完要复查：很多编辑器/写文件 API 保存时会**去掉 BOM**，改一次就要补一次。

## 2. 用户级环境变量对"已经跑着的进程"不可见

**现象**：刚用 `[Environment]::SetEnvironmentVariable('X', $v, 'User')` 设完，
在同一个会话的脚本里读 `$env:X` 是空的，怀疑设置失败。

**原因**：User 级变量写进注册表，只影响**之后新创建的**进程。
当前进程（及其子进程）沿用旧的环境块。

**做法**：
- 脚本里不要假设变量已存在，统一走兜底函数：

```powershell
function Get-EnvOr([string]$Name, [string]$Default) {
    $v = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($v)) { return $Default }
    return $v
}
```

- 验证要在**新开的终端**里做，不要在设置它的那个会话里验证。

## 3. `$x = if (...) {...} else {...}` 在这类脚本里不稳

用 `if` 语句赋值的写法本身合法，但在 5.1 里配合"从文件读取的脚本 + 中文注释 + BOM 缺失"时，
出现过赋值结果为空、而相邻的同结构语句正常的情况。排查成本远高于收益。

**做法**：直接抽成函数（见上一条的 `Get-EnvOr`），一行一个调用，不要用语句赋值。

## 4. .npmrc 少一个结尾换行，两条配置会粘成一条

**现象**：往 `~/.npmrc` 追加 `store-dir=...`，结果变成
`registry=https://...comstore-dir=D:\env\cache\pnpm`，pnpm 仍在用旧位置。

**原因**：原文件最后一行没有换行符，追加内容直接接在同一行。

**做法**：**整份重写**，不要 `Add-Content`。写完 `Get-Content` 看一遍。

```powershell
@"
registry=https://registry.npmmirror.com
store-dir=D:\env\cache\pnpm
"@ | Set-Content "$env:USERPROFILE\.npmrc" -Encoding utf8
```

顺带：pnpm 的 `store-dir` 只认配置，不认环境变量；`PNPM_HOME` 是另一件事（全局 bin），
别混用。

## 5. mise：`node = "system"` 已废弃

新版 mise 会告警：`deprecated [system_tool_version]: @system is deprecated, use MISE_DISABLE_TOOLS`。

**做法**：不需要 mise 接管某个运行时，就**不要在 `[tools]` 里写它**（整段省略即可）。
要固定版本时写具体版本号，`mise install` 只会落到 `MISE_DATA_DIR`。

## 6. 递归统计体积：一个 try/catch 包住整个 foreach 会严重少算

**现象**：手写的 `Get-Stat` 报某目录 0.03 GB，实际里面躺着一个 49 GB 的 vhdx。

**原因**：

```powershell
try {
    foreach ($sd in $di.EnumerateDirectories()) { $stack.Push($sd.FullName) }
} catch { }      # 任一子目录抛异常，剩余子目录全部丢失，且无声
```

`EnumerateDirectories()` 是惰性迭代，权限错误在迭代途中抛出，
被整段 catch 吞掉后，**后面还没取到的子目录就再也不会入栈**。

**做法**（按需选一个）：
- 逐条 `try/catch`，或改用 `Get-ChildItem -ErrorAction SilentlyContinue`（按项容错）
- 用 `du -sm <dir>/*`（Git Bash 自带）这类外部工具交叉验证
- **以磁盘可用空间的前后差值作为权威数字**，逻辑大小只做参考

同时别忘了：
- 跳过 reparse point（junction/symlink），否则会重复计算甚至绕圈
- 硬链接与稀疏文件会让"逻辑大小之和"远大于实际释放量。本机实测删除 151 GB 逻辑大小，
  可用空间只增加约 129 GB —— 这是正常的，不是删漏了

## 7. 别把 WSL / Docker 的虚拟盘当成"普通文件夹"

`%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx`、`%LOCALAPPDATA%\wsl\{guid}\ext4.vhdx`
经常一个就几十 GB，而且是**稀疏文件**：`Length` 报的是上限，不一定是占用。

- 删除前确认对应服务已停（`wsl --shutdown`、退出 Docker Desktop）
- 想保留数据只回收空间，用 `diskpart` → `select vdisk file=...` → `compact vdisk`（需管理员）
- 直接删 vhdx = 清空该发行版/该 Docker 的所有数据，不可逆

## 8. 两个 profile，不是同一个

| shell | profile 路径 |
| --- | --- |
| pwsh 7 | `%USERPROFILE%\Documents\PowerShell\profile.ps1` |
| Windows PowerShell 5.1 | `%USERPROFILE%\Documents\WindowsPowerShell\profile.ps1` |

只写一个的话，换个 shell 就"配置消失"。写之前先读原文件——里面常常有用户自己攒的
别名/函数（例如某个 `od` 启动器），直接覆盖等于把人家的东西删了。

**做法**：用带标记的段落包裹自己写的内容，重跑时只替换这一段：

```
# >>> fit >>>
...
# <<< fit <<<
```

## 9. 后台任务与长路径

- 大目录遍历超过工具默认超时会被转到后台；此时**不要**再起一个同样的遍历（IO 会互相拖死），
  先看进程是否还在跑。
- 路径超过 260 字符时 `DirectoryInfo.EnumerateFiles` 会抛 `PathTooLongException`，
  同样会被上面的 catch 吞掉 → 少算。用 `\\?\` 前缀或 `robocopy /L` 处理超长路径。
