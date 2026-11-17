#Requires -Version 5.1
<#
.SYNOPSIS
    仓库统一入口 —— 复制到 <repo>/tools/ws.ps1，按需加子命令。

.DESCRIPTION
    存在的意义不是"省几条命令"，而是改变默认行为：
    以后新加的工具会往这里挂，而不是再开一个 scripts 目录。

    只做只读/可预览的操作；真正会删东西的动作必须显式 -Apply。

.EXAMPLE
    .\tools\ws.ps1 doctor
    .\tools\ws.ps1 projects
    .\tools\ws.ps1 clean            # 只预览
    .\tools\ws.ps1 clean -Apply     # 真删
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)][string]$Command = 'doctor',
    [switch]$Apply
)

# 用 Continue 而不是 Stop：git 之类原生命令往 stderr 写正常信息（比如空仓库），
# 在 5.1 里会被 Stop 当成终止性错误。
$ErrorActionPreference = 'Continue'

$RepoRoot = Split-Path -Parent $PSScriptRoot

# ---- 按仓库实际情况改这两个常量 -------------------------------------------
$PythonRel = '.venv\Scripts\python.exe'   # 没有虚拟环境就留空
$SrcRel    = 'src'
# ---------------------------------------------------------------------------

function Get-DirGB([string]$p) {
    $sum = (Get-ChildItem -LiteralPath $p -Recurse -Force -File -ErrorAction SilentlyContinue |
        Measure-Object Length -Sum).Sum
    if (-not $sum) { return 0 }
    [math]::Round($sum / 1GB, 2)
}

function Get-GitValue([string[]]$GitArgs) {
    try {
        $out = & git -C $RepoRoot @GitArgs 2>$null
        if ($LASTEXITCODE -ne 0) { return '-' }
        $v = ($out | Out-String).Trim()
        if ([string]::IsNullOrWhiteSpace($v)) { return '-' }
        return $v
    } catch { return '-' }
}

function Get-GitDirty([string]$path) {
    try {
        $n = (& git -C $path status --porcelain 2>$null | Measure-Object).Count
        if ($LASTEXITCODE -ne 0) { return '-' }
        return $n
    } catch { return '-' }
}

function Invoke-Python {
    param([string[]]$PyArgs)
    $py = Join-Path $RepoRoot $PythonRel
    if (-not (Test-Path $py)) { throw "找不到 $py（先建虚拟环境，或改 ws.ps1 顶部的 `$PythonRel）" }
    $env:PYTHONPATH = Join-Path $RepoRoot $SrcRel
    & $py @PyArgs
}

switch ($Command.ToLower()) {
    'doctor' {
        # 换成仓库自己的自检命令
        $py = Join-Path $RepoRoot $PythonRel
        if (Test-Path $py) { & $py -c "import sys; print('python', sys.version.split()[0])" }
        $mise = if (Get-Command mise -ErrorAction SilentlyContinue) { (& mise --version 2>$null | Out-String).Trim() } else { 'missing' }
        "repo   : $RepoRoot"
        "git    : $(Get-GitValue @('rev-parse','--abbrev-ref','HEAD'))"
        "dirty  : $(Get-GitDirty $RepoRoot) file(s)"
        "mise   : $mise"
    }

    'projects' {
        # 子项目一览：体积 / 分支 / 未提交文件数
        $skip = @('node_modules', 'tools', 'src', 'tests', 'docs')
        $roots = @(Get-ChildItem -LiteralPath $RepoRoot -Directory -Force -ErrorAction SilentlyContinue |
            Where-Object { -not $_.Name.StartsWith('.') -and $skip -notcontains $_.Name })

        $rows = foreach ($d in $roots) {
            $isGit = Test-Path (Join-Path $d.FullName '.git')
            [pscustomobject]@{
                Name    = $d.Name
                GB      = Get-DirGB $d.FullName
                Branch  = if ($isGit) { (& git -C $d.FullName rev-parse --abbrev-ref HEAD 2>$null) } else { '-' }
                Dirty   = if ($isGit) { Get-GitDirty $d.FullName } else { '-' }
                Updated = $d.LastWriteTime.ToString('yyyy-MM-dd')
            }
        }
        if ($rows) { $rows | Sort-Object GB -Descending | Format-Table -AutoSize }
        else { '(没有子项目目录)' }
    }

    'clean' {
        # 只清构建产物，不碰源码和 .git
        $junk = @('node_modules', '.venv', 'venv', '__pycache__', '.pytest_cache',
            '.ruff_cache', '.mypy_cache', 'dist', 'build', 'target', '.next', '.turbo', 'coverage')
        $total = 0L
        foreach ($j in $junk) {
            $hits = Get-ChildItem -LiteralPath $RepoRoot -Directory -Recurse -Depth 4 -Force -Filter $j -ErrorAction SilentlyContinue
            foreach ($hit in $hits) {
                if ($hit.FullName -match '\\node_modules\\') { continue }
                $s = (Get-ChildItem -LiteralPath $hit.FullName -Recurse -Force -File -ErrorAction SilentlyContinue |
                    Measure-Object Length -Sum).Sum
                if (-not $s) { continue }
                $total += $s
                $rel = $hit.FullName.Replace($RepoRoot, '.')
                if ($Apply) {
                    Remove-Item -LiteralPath $hit.FullName -Recurse -Force -ErrorAction SilentlyContinue
                    "removed {0,8} MB  {1}" -f [math]::Round($s / 1MB, 1), $rel
                } else {
                    "would remove {0,8} MB  {1}" -f [math]::Round($s / 1MB, 1), $rel
                }
            }
        }
        "total: $([math]::Round($total / 1GB, 2)) GB  (apply=$Apply)"
    }

    # ---- 按仓库需要加子命令 -------------------------------------------------
    # 'test' { Invoke-Python @('-m', 'pytest', '-q') }
    # 'fmt'  { Invoke-Python @('-m', 'ruff', 'format', '.') }

    default {
        'usage: ws.ps1 doctor | projects | clean [-Apply]'
    }
}
