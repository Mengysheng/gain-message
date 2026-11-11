#Requires -Version 5.1
<#
.SYNOPSIS
    在本机跑一轮通告检查，供 Windows 计划任务调用。

.DESCRIPTION
    做四件事：
      1. 加载仓库根目录的 .env（SMTP 授权码不写进仓库）
      2. 等网络就绪（开机后 Wi-Fi 还没连上时不会白跑一次）
      3. 跑 node src/cli.js run
      4. 输出写进 logs\radar-YYYY-MM-DD.log，保留 N 天

    已经在跑的时候不会重复启动（用 logs\run.lock 判断）。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-local.ps1

.EXAMPLE
    .\scripts\run-local.ps1 -DryRun          # 只预览，不发信不写状态

.EXAMPLE
    .\scripts\run-local.ps1 -PushState       # 跑完把 state 提交回仓库
#>
[CmdletBinding()]
param(
    [string]$Config = 'config.yaml',

    # 开机后等网络就绪的上限（秒）。等不到也会强行跑一次，失败日志里有记录。
    [int]$WaitSeconds = 180,

    [int]$KeepLogDays = 30,

    # 跑完把 state/ 提交并推送回仓库（本地 + Actions 双跑时，避免重复推送同一条）
    [switch]$PushState,

    # 只预览：不发信、不写状态
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$logDir = Join-Path $repo 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ('radar-{0}.log' -f (Get-Date -Format 'yyyy-MM-dd'))

function Write-Log {
    param([string]$Message)
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    [IO.File]::AppendAllText($logFile, $line + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))
    Write-Host $line
}

function Test-TcpPort {
    param([string]$TargetHost, [int]$Port, [int]$TimeoutMs = 3000)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $task = $client.ConnectAsync($TargetHost, $Port)
        if ($task.Wait($TimeoutMs) -and $client.Connected) { return $true }
        return $false
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

# ---------------------------------------------------------------- 单实例
$lockFile = Join-Path $logDir 'run.lock'
if (Test-Path $lockFile) {
    $lockPid = 0
    [int]::TryParse(((Get-Content $lockFile -Raw -ErrorAction SilentlyContinue) -replace '\s', ''), [ref]$lockPid) | Out-Null
    if ($lockPid -gt 0 -and (Get-Process -Id $lockPid -ErrorAction SilentlyContinue)) {
        Write-Log "上一次运行还在进行中（PID $lockPid），这次跳过"
        return
    }
}
Set-Content -Path $lockFile -Value $PID -Encoding ASCII

try {
    Write-Log '================ 开始一轮检查 ================'
    Write-Log "仓库：$repo"

    # ------------------------------------------------------------ 环境变量
    $envFile = Join-Path $repo '.env'
    if (Test-Path $envFile) {
        $loaded = 0
        foreach ($raw in Get-Content $envFile -Encoding UTF8) {
            $line = $raw.Trim()
            if (-not $line -or $line.StartsWith('#')) { continue }
            $eq = $line.IndexOf('=')
            if ($eq -lt 1) { continue }
            $key = $line.Substring(0, $eq).Trim()
            $value = $line.Substring($eq + 1).Trim().Trim('"').Trim("'")
            [Environment]::SetEnvironmentVariable($key, $value, 'Process')
            $loaded++
        }
        Write-Log ".env 已加载（$loaded 项）"
    } else {
        Write-Log '.env 不存在：如果 SMTP_* 不在系统环境变量里，这次会因缺邮箱配置而失败'
    }

    # ------------------------------------------------------------ 等网络
    if ($WaitSeconds -gt 0) {
        $deadline = (Get-Date).AddSeconds($WaitSeconds)
        $ready = $false
        while ((Get-Date) -lt $deadline) {
            if (Test-TcpPort -TargetHost 'jwc.scu.edu.cn' -Port 443) { $ready = $true; break }
            Start-Sleep -Seconds 10
        }
        if ($ready) {
            Write-Log '网络已就绪'
        } else {
            Write-Log "等待 ${WaitSeconds} 秒仍连不上站点，照常运行一次（日志会记录失败原因）"
        }
    }

    # ------------------------------------------------------------ 跑
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        Write-Log '找不到 node.exe。装好 Node.js，或把它加进 PATH 后再试。'
        exit 1
    }

    $nodeArgs = @('src/cli.js', 'run', '--config', $Config)
    if ($DryRun) { $nodeArgs += @('--dry-run', '--no-email') }

    Write-Log ('执行：node ' + ($nodeArgs -join ' '))
    $started = Get-Date
    # 两个坑要一起处理：
    #  1. $ErrorActionPreference='Stop' 时，node 往 stderr 写一行（警告之类）会被当成终止错误
    #  2. PowerShell 5.1 默认按控制台代码页（GBK）解码子进程输出，而 node 输出的是 UTF-8，
    #     不显式设成 UTF-8 的话，日志里的中文会变成「宸濆ぇ鏁欏姟澶劼」这种乱码
    $prevEap = $ErrorActionPreference
    $prevOutEnc = [Console]::OutputEncoding
    $ErrorActionPreference = 'Continue'
    try {
        [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
        & $nodeCmd.Source @nodeArgs 2>&1 | ForEach-Object { Write-Log ([string]$_).TrimEnd() }
        $code = $LASTEXITCODE
    } finally {
        [Console]::OutputEncoding = $prevOutEnc
        $ErrorActionPreference = $prevEap
    }
    $cost = [int]((Get-Date) - $started).TotalSeconds
    Write-Log "退出码 $code，用时 ${cost}s"

    # ------------------------------------------------------------ 提交 state
    if ($PushState -and -not $DryRun) {
        git add state 2>&1 | ForEach-Object { Write-Log $_ }
        $dirty = git status --porcelain state
        if ($dirty) {
            git commit -m 'chore: 更新通告去重状态 [skip ci]' 2>&1 | ForEach-Object { Write-Log $_ }
            git push 2>&1 | ForEach-Object { Write-Log $_ }
            Write-Log '状态已推回仓库'
        } else {
            Write-Log '状态没有变化，跳过提交'
        }
    }

    # ------------------------------------------------------------ 清旧日志
    Get-ChildItem $logDir -Filter 'radar-*.log' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepLogDays) } |
        Remove-Item -Force -ErrorAction SilentlyContinue

    Write-Log '================ 本轮结束 ================'
    exit $code
} catch {
    Write-Log ('运行出错：' + $_.Exception.Message)
    exit 1
} finally {
    Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
}
