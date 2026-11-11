#Requires -Version 5.1
<#
.SYNOPSIS
    把 notice-radar 注册成 Windows 计划任务：开机（登录）后自动跑一轮，可选每 N 小时再跑。

.DESCRIPTION
    默认用「登录时触发」而不是「启动时触发」：
    计划任务在「启动时」以 SYSTEM 身份运行，而 Wi-Fi 的账号密码是存在每个用户下的，
    SYSTEM 上下文里连不上 Wi-Fi，任务会白跑。登录时触发就一定在你的网络环境里。

    如果你是有线网络 / 台式机，可以加 -AtStartup 改成真正的开机触发。

.EXAMPLE
    # 登录后 1 分钟跑一轮，之后每 2 小时再跑一次（推荐）
    .\scripts\install-boot-task.ps1

.EXAMPLE
    # 只要「每次开机跑一遍」，不做周期运行
    .\scripts\install-boot-task.ps1 -RepeatHours 0

.EXAMPLE
    # 台式机 / 有线网络：真正的开机触发
    .\scripts\install-boot-task.ps1 -AtStartup

.EXAMPLE
    # 注册完立刻试跑一次
    .\scripts\install-boot-task.ps1 -RunNow

.EXAMPLE
    # 卸载
    .\scripts\install-boot-task.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [string]$TaskName = 'NoticeRadar',

    # 用「开机启动」而不是「登录时」触发（需要有线网络，见 DESCRIPTION）
    [switch]$AtStartup,

    # 触发后延迟多少秒再跑，给网络和磁盘一点时间
    [int]$DelaySeconds = 60,

    # 每隔几小时再跑一次；0 = 只在开机/登录时跑
    [int]$RepeatHours = 2,

    # 跑完把 state 推回仓库（本地 + Actions 双跑时用，避免重复推送）
    [switch]$PushState,

    # 注册完立刻启动一次
    [switch]$RunNow,

    # 卸载任务
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $repo 'scripts\run-local.ps1'
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

if ($Uninstall) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $existing) {
        Write-Host "没有找到计划任务 $TaskName，无需卸载。"
        return
    }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "已卸载计划任务 $TaskName。"
    return
}

if (-not (Test-Path $runner)) {
    throw "找不到 $runner"
}

# ---------------------------------------------------------------- 动作
$argument = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $runner
if ($PushState) { $argument += ' -PushState' }

$action = New-ScheduledTaskAction -Execute $psExe -Argument $argument -WorkingDirectory $repo

# ---------------------------------------------------------------- 触发器
$triggers = @()

if ($AtStartup) {
    $boot = New-ScheduledTaskTrigger -AtStartup
    $boot.Delay = "PT${DelaySeconds}S"
    $triggers += $boot
} else {
    $logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $logon.Delay = "PT${DelaySeconds}S"
    $triggers += $logon
}

if ($RepeatHours -gt 0) {
    # 重复时长用 3650 天（十年）当「无限」：直接给 MaxValue 会让任务 XML 变成
    # P99999999DT23H59M59S，计划任务服务会拒绝注册（0x80041318）。
    $repeat = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(10)) `
        -RepetitionInterval (New-TimeSpan -Hours $RepeatHours) `
        -RepetitionDuration (New-TimeSpan -Days 3650)
    $triggers += $repeat
}

# ---------------------------------------------------------------- 设置
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

# ---------------------------------------------------------------- 注册
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Description '按关键词检查学校通告并发邮件（notice-radar）。日志在 logs\ 目录。' `
    -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host ''
Write-Host "✓ 已注册计划任务：$TaskName"
Write-Host "  触发方式：$(if ($AtStartup) { '开机启动' } else { '登录时' })（延迟 ${DelaySeconds}s）$(if ($RepeatHours -gt 0) { "，之后每 ${RepeatHours} 小时一次" })"
Write-Host "  运行脚本：$runner"
Write-Host "  状态：$($task.State)"
Write-Host "  下次运行：$($info.NextRunTime)"
Write-Host ''
Write-Host '提示：任务计划程序里可以直接改触发器；日志在 logs\radar-今天.log'

if ($RunNow) {
    Write-Host ''
    Write-Host '立刻试跑一次 …'
    Start-ScheduledTask -TaskName $TaskName
    Write-Host '已触发。等 30 秒后看 logs\ 目录里最新的日志。'
}
