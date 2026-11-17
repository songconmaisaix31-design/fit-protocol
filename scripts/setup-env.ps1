#Requires -Version 5.1
<#
.SYNOPSIS
    把散落的开发环境收敛到一个根目录（幂等，默认不删任何东西）。

.DESCRIPTION
    做四件事：
      1. 建 <Root> 下的目录骨架
      2. 把用户级环境变量指向 <Root>（运行时目录 + 各类缓存）
      3. 生成 <Root>\mise.toml（已存在则不动）
      4. 安装统一入口 <Root>\tools\tools.ps1（已存在则不动，除非 -Force）

    可选：
      -InstallMise   从 GitHub Releases 下 mise 到 <Root>\bin
      -WireProfile   把 <Root>\tools 写进 PowerShell profile（备份 + 标记段，幂等）

.PARAMETER Root
    根目录。默认 D:\env。不要用带空格的路径，不要放系统盘根目录下太深的地方。

.PARAMETER WhatIf
    只打印将要做什么，不落盘、不改环境变量。

.EXAMPLE
    .\setup-env.ps1 -Root D:\env -WhatIf
    .\setup-env.ps1 -Root D:\env -InstallMise -WireProfile
#>
[CmdletBinding()]
param(
    [string]$Root = 'D:\env',
    [switch]$WhatIf,
    [switch]$InstallMise,
    [switch]$WireProfile,
    [switch]$Force,
    [switch]$SkipEnvVars,
    [string]$Proxy = ''
)

$ErrorActionPreference = 'Stop'
$created = New-Object System.Collections.Generic.List[string]
$skipped = New-Object System.Collections.Generic.List[string]

function Say([string]$msg, [string]$kind = 'info') {
    switch ($kind) {
        'ok'   { Write-Host "  [ok]   $msg" -ForegroundColor Green }
        'skip' { Write-Host "  [skip] $msg" -ForegroundColor DarkGray }
        'warn' { Write-Host "  [warn] $msg" -ForegroundColor Yellow }
        default { Write-Host "  $msg" }
    }
}

function Ensure-Dir([string]$path) {
    if (Test-Path -LiteralPath $path) { $skipped.Add($path); return }
    if ($WhatIf) { Say "would create $path"; return }
    New-Item -ItemType Directory -Force -Path $path | Out-Null
    $created.Add($path)
    Say "created $path" 'ok'
}

# ---------------------------------------------------------------- 0. 校验
Write-Host "`n== env-unify: $Root ==" -ForegroundColor Cyan

if ($Root -match '\s') { throw "根目录不要带空格：$Root" }
$drive = (Split-Path -Qualifier $Root)
if (-not (Test-Path $drive)) { throw "盘符不存在：$drive" }

$driveInfo = [System.IO.DriveInfo]::new($drive.TrimEnd(':'))
$freeGB = [math]::Round($driveInfo.AvailableFreeSpace / 1GB, 1)
Say "目标盘 $drive 可用 $freeGB GB"
if ($drive -eq ($env:SystemDrive) -and $freeGB -lt 20) {
    Say "系统盘空间偏紧，建议把根目录放到数据盘" 'warn'
}

# ---------------------------------------------------------------- 1. 目录骨架
$dirs = @(
    $Root,
    (Join-Path $Root 'mise'),
    (Join-Path $Root 'cache'),
    (Join-Path $Root 'cache\npm'),
    (Join-Path $Root 'cache\pnpm'),
    (Join-Path $Root 'cache\uv'),
    (Join-Path $Root 'cache\pip'),
    (Join-Path $Root 'cache\go\mod'),
    (Join-Path $Root 'cache\go\build'),
    (Join-Path $Root 'tools')
)
Write-Host "`n-- 目录" -ForegroundColor Cyan
foreach ($d in $dirs) { Ensure-Dir $d }

# ---------------------------------------------------------------- 2. 环境变量
Write-Host "`n-- 环境变量（用户级，新开终端生效）" -ForegroundColor Cyan
$envVars = [ordered]@{
    MISE_DATA_DIR           = (Join-Path $Root 'mise')
    MISE_CACHE_DIR          = (Join-Path $Root 'cache\mise')
    MISE_GLOBAL_CONFIG_FILE = (Join-Path $Root 'mise.toml')
    MISE_SHARED_ROOT        = $Root
    npm_config_cache        = (Join-Path $Root 'cache\npm')
    UV_CACHE_DIR            = (Join-Path $Root 'cache\uv')
    PIP_CACHE_DIR           = (Join-Path $Root 'cache\pip')
    GOMODCACHE              = (Join-Path $Root 'cache\go\mod')
    GOCACHE                 = (Join-Path $Root 'cache\go\build')
}
foreach ($k in $envVars.Keys) {
    $v = $envVars[$k]
    if ($SkipEnvVars) { Say "跳过（-SkipEnvVars）$k" 'skip'; continue }
    if ($WhatIf) { Say "would set $k = $v"; continue }
    [Environment]::SetEnvironmentVariable($k, $v, 'User')
    Set-Item -Path "Env:$k" -Value $v
    Say "$k = $v" 'ok'
}

# ---------------------------------------------------------------- 3. mise.toml
$miseToml = Join-Path $Root 'mise.toml'
Write-Host "`n-- mise 配置" -ForegroundColor Cyan
if ((Test-Path $miseToml) -and -not $Force) {
    Say "$miseToml 已存在，保持不动（-Force 才覆盖）" 'skip'
} elseif ($WhatIf) {
    Say "would write $miseToml"
} else {
    $esc = $Root.Replace('\', '\\')
    @"
# 由 env-unify 生成。运行时不在这里声明，直接复用机器上已有的，
# 需要固定版本时取消 [tools] 注释再 `mise install`。
#
# [tools]
# node   = "24"
# python = "3.13"

[env]
MISE_SHARED_ROOT = "$esc"
NPM_CONFIG_CACHE  = "$esc\\cache\\npm"
UV_CACHE_DIR      = "$esc\\cache\\uv"
PIP_CACHE_DIR     = "$esc\\cache\\pip"
GOMODCACHE        = "$esc\\cache\\go\\mod"
GOCACHE           = "$esc\\cache\\go\\build"

[tasks.doctor]
description = "查看当前解析到的工具链"
run = "mise ls --current"
"@ | Set-Content -LiteralPath $miseToml -Encoding UTF8
    Say "wrote $miseToml" 'ok'
}

# ---------------------------------------------------------------- 4. tools 入口
Write-Host "`n-- 统一入口" -ForegroundColor Cyan
$toolsTarget = Join-Path $Root 'tools\tools.ps1'
$toolsSource = Join-Path $PSScriptRoot 'tools.ps1'
if ((Test-Path $toolsTarget) -and -not $Force) {
    Say "$toolsTarget 已存在，保持不动" 'skip'
} elseif (-not (Test-Path $toolsSource)) {
    Say "找不到 $toolsSource，跳过" 'warn'
} elseif ($WhatIf) {
    Say "would copy tools.ps1 -> $toolsTarget"
} else {
    Copy-Item $toolsSource $toolsTarget -Force
    Say "installed $toolsTarget" 'ok'
}

# ---------------------------------------------------------------- 5. mise 本体
Write-Host "`n-- mise" -ForegroundColor Cyan
if (Get-Command mise -ErrorAction SilentlyContinue) {
    Say "mise 已在 PATH：$((Get-Command mise).Source)" 'skip'
} elseif (-not $InstallMise) {
    Say "未安装。加 -InstallMise，或自行 winget install jdx.mise" 'warn'
} else {
    $bin = Join-Path $Root 'bin'
    Ensure-Dir $bin
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("mise-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    $iwr = @{ UseBasicParsing = $true; TimeoutSec = 120; Headers = @{ 'User-Agent' = 'env-unify' } }
    if ($Proxy) { $iwr['Proxy'] = $Proxy }
    try {
        $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/jdx/mise/releases/latest' @iwr
        $asset = $rel.assets | Where-Object { $_.name -match 'windows-x64\.zip$' } | Select-Object -First 1
        if (-not $asset) { throw 'release 里没有 windows-x64.zip' }
        $zip = Join-Path $tmp 'mise.zip'
        if ($WhatIf) { Say "would download $($asset.name)"; return }
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip @iwr
        Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
        $exe = Get-ChildItem $tmp -Recurse -Filter 'mise.exe' | Select-Object -First 1
        Copy-Item $exe.FullName (Join-Path $bin 'mise.exe') -Force
        Say "installed $(Join-Path $bin 'mise.exe') ($($rel.tag_name))" 'ok'
        if (-not $WhatIf) {
            $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
            if ($userPath -notlike "*$bin*") {
                [Environment]::SetEnvironmentVariable('Path', "$bin;$userPath", 'User')
                Say "已把 $bin 加入用户 PATH（新终端生效）" 'ok'
            }
        }
    } catch {
        Say "下载失败：$($_.Exception.Message)" 'warn'
        Say "可改用：winget install jdx.mise" 'warn'
    } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------- 6. profile
Write-Host "`n-- shell 接线" -ForegroundColor Cyan
if (-not $WireProfile) {
    Say "未启用。加 -WireProfile 可写入 PowerShell profile" 'skip'
} else {
    $markerStart = '# >>> env-unify >>>'
    $markerEnd = '# <<< env-unify <<<'
    $block = @"
$markerStart
`$env:Path = "$Root\tools;`$env:Path"
function tools { & powershell -NoProfile -ExecutionPolicy Bypass -File "$Root\tools\tools.ps1" @args }
`$env:MISE_PWSH_CHPWD_WARNING = '0'
if (Get-Command mise -ErrorAction SilentlyContinue) {
    try { (& mise activate pwsh 2>`$null) | Out-String | Invoke-Expression } catch {}
}
$markerEnd
"@
    $profiles = @(
        (Join-Path $env:USERPROFILE 'Documents\PowerShell\profile.ps1'),
        (Join-Path $env:USERPROFILE 'Documents\WindowsPowerShell\profile.ps1')
    )
    foreach ($p in $profiles) {
        if ($WhatIf) { Say "would wire $p"; continue }
        $dir = Split-Path -Parent $p
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        $existing = ''
        if (Test-Path $p) {
            $existing = Get-Content -LiteralPath $p -Raw -ErrorAction SilentlyContinue
            if ($existing -match [regex]::Escape($markerStart)) {
                $existing = [regex]::Replace($existing,
                    "(?s)" + [regex]::Escape($markerStart) + ".*?" + [regex]::Escape($markerEnd),
                    $block)
            } else {
                $existing = $existing.TrimEnd() + "`r`n`r`n" + $block + "`r`n"
            }
        } else {
            $existing = $block + "`r`n"
        }
        # PowerShell 5.1 会把无 BOM 的 UTF-8 当 ANSI 读，中文注释会破坏语法
        [System.IO.File]::WriteAllText($p, $existing, (New-Object System.Text.UTF8Encoding($true)))
        Say "wired $p" 'ok'
    }
}

# ---------------------------------------------------------------- 7. 收尾
Write-Host "`n== 完成 ==" -ForegroundColor Cyan
Say "新建 $(@($created).Count) 项，跳过 $(@($skipped).Count) 项"
Write-Host @"

下一步：
  1. 重开一个终端（环境变量只对新进程生效）
  2. tools list        # 确认工具都被纳管
  3. tools doctor      # 确认缓存指向 $Root\cache
  4. 各项目删掉本地 node_modules/.venv 后重装，验证不再产生下载

仓库侧收敛（可选）：把 mise.toml 和 tools/ws.ps1 放进仓库根目录，
让仓库也有唯一入口。参见 SKILL.md 的「仓库侧收敛」一节。
"@
