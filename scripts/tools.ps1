#Requires -Version 5.1
<#
.SYNOPSIS
    统一工具入口 —— 一台机器上所有开发工具的单一入口。

.DESCRIPTION
    放在 <ROOT>\tools\tools.ps1，自己从脚本位置推断根目录，
    所以整个 <ROOT> 可以整体搬走或改名。

.EXAMPLE
    tools.ps1 list          列出纳管工具
    tools.ps1 which node    某个工具的真实路径
    tools.ps1 doctor        缓存位置 / 磁盘 / mise 自检
    tools.ps1 clean         清共享缓存（可安全重下）
    tools.ps1 json          机器可读输出
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)][string]$Command = 'list',
    [Parameter(Position = 1, ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = 'Stop'

# 根目录：优先环境变量，其次本脚本的上级目录
$Root = if ($env:MISE_SHARED_ROOT) { $env:MISE_SHARED_ROOT } else { Split-Path -Parent $PSScriptRoot }

# 用户级环境变量在已经跑起来的进程里可能还没生效，统一走这里取
function Get-EnvOr([string]$Name, [string]$Default) {
    $v = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($v)) { return $Default }
    return $v
}

$Tools = [ordered]@{
    mise   = 'mise'
    node   = 'node'
    npm    = 'npm'
    pnpm   = 'pnpm'
    yarn   = 'yarn'
    python = 'python'
    pip    = 'pip'
    uv     = 'uv'
    go     = 'go'
    git    = 'git'
    gh     = 'gh'
    docker = 'docker'
    wsl    = 'wsl'
    java   = 'java'
    dotnet = 'dotnet'
    rg     = 'rg'
    jq     = 'jq'
    curl   = 'curl'
}

function Get-ToolInfo([string]$Name, [string]$Cmd) {
    $c = Get-Command $Cmd -ErrorAction SilentlyContinue
    if (-not $c) { return [pscustomobject]@{ Name = $Name; Version = '-'; Path = '(not found)' } }
    $ver = ''
    try {
        # 有的工具把版本写到 stderr，2>&1 统一收
        $ver = (& $c.Source --version 2>&1 | Select-Object -First 1 | Out-String).Trim()
        if ($ver.Length -gt 48) { $ver = $ver.Substring(0, 48) }
    } catch { $ver = '?' }
    [pscustomobject]@{ Name = $Name; Version = $ver; Path = $c.Source }
}

function Get-Catalog {
    foreach ($k in $Tools.Keys) { Get-ToolInfo $k $Tools[$k] }
}

function Get-DirMB([string]$p) {
    if (-not (Test-Path -LiteralPath $p)) { return 0 }
    $s = (Get-ChildItem -LiteralPath $p -Recurse -Force -File -ErrorAction SilentlyContinue |
        Measure-Object Length -Sum).Sum
    if (-not $s) { return 0 }
    [math]::Round($s / 1MB, 1)
}

switch ($Command.ToLower()) {
    'list' {
        $rows = @(Get-Catalog)
        $rows | Format-Table -AutoSize
        $found = ($rows | Where-Object { $_.Path -ne '(not found)' }).Count
        "`n$found/$($rows.Count) tools found · shared root: $Root"
    }
    'which' {
        $n = $Rest[0]
        if (-not $n) { throw 'usage: tools.ps1 which <name>' }
        $c = Get-Command $n -ErrorAction SilentlyContinue
        if ($c) { $c.Source } else { "not found: $n"; exit 1 }
    }
    'json' {
        Get-Catalog | ConvertTo-Json -Depth 3
    }
    'doctor' {
        $miseDir = Get-EnvOr 'MISE_DATA_DIR' (Join-Path $Root 'mise')
        $npmDir  = Get-EnvOr 'npm_config_cache' (Join-Path $Root 'cache\npm')
        $uvDir   = Get-EnvOr 'UV_CACHE_DIR' (Join-Path $Root 'cache\uv')
        $pipDir  = Get-EnvOr 'PIP_CACHE_DIR' (Join-Path $Root 'cache\pip')
        $goDir   = Get-EnvOr 'GOMODCACHE' (Join-Path $Root 'cache\go\mod')

        "shared root      : $Root"
        "mise data dir    : $miseDir"
        "npm cache        : $npmDir"
        "uv cache         : $uvDir"
        "pip cache        : $pipDir"
        "go mod cache     : $goDir"
        ""
        if (Get-Command mise -ErrorAction SilentlyContinue) { & mise --version } else { 'mise: MISSING' }
        ""
        Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
            Where-Object { $_.Free -ne $null -and $_.Name -match '^[A-Z]$' } |
            Select-Object Name,
                @{n = 'FreeGB'; e = { [math]::Round($_.Free / 1GB, 1) } },
                @{n = 'UsedGB'; e = { [math]::Round($_.Used / 1GB, 1) } } |
            Format-Table -AutoSize
        foreach ($sub in 'cache\npm', 'cache\pnpm', 'cache\uv', 'cache\pip', 'cache\go', 'mise') {
            "{0,-14} {1,8} MB" -f $sub, (Get-DirMB (Join-Path $Root $sub))
        }
    }
    'clean' {
        # 只清缓存，不碰运行时目录；清完下次装依赖会重新下载，属预期
        foreach ($sub in 'cache\npm', 'cache\uv', 'cache\pip', 'cache\go\build') {
            $p = Join-Path $Root $sub
            if (-not (Test-Path -LiteralPath $p)) { continue }
            $mb = Get-DirMB $p
            Get-ChildItem -LiteralPath $p -Force -ErrorAction SilentlyContinue |
                Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
            "cleaned {0,-12} {1,7} MB" -f $sub, $mb
        }
    }
    default {
        'usage: tools.ps1 list | which <tool> | doctor | clean | json'
    }
}
