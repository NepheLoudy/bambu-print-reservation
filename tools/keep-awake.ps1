# qianli keep-awake: prevent system sleep until HH:mm today (default 10:30).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File keep-awake.ps1 [-Until "10:30"] [-NoDisplay]
# Send ESC each 60s via SetThreadExecutionState. Ctrl+C or kill the process to cancel.
param(
  [string]$Until = "10:30",
  [switch]$NoDisplay
)

$code = @"
using System;
using System.Runtime.InteropServices;
public static class QlAwake {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
"@
Add-Type -TypeDefinition $code

$ES_CONTINUOUS = [uint32]2147483648      # 0x80000000
$ES_SYSTEM_REQUIRED = [uint32]1          # 0x00000001
$ES_DISPLAY_REQUIRED = [uint32]2         # 0x00000002

$target = Get-Date $Until
if ((Get-Date) -ge $target) {
  Write-Output ("PAST_DEADLINE " + $target.ToString("yyyy-MM-dd HH:mm") + " - nothing to do")
  exit 0
}

$flags = $ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED
if (-not $NoDisplay) { $flags = $flags -bor $ES_DISPLAY_REQUIRED }

$mode = "system awake + display on"
if ($NoDisplay) { $mode = "system awake, display may sleep" }

Write-Output ("KEEP_AWAKE active until " + $target.ToString("yyyy-MM-dd HH:mm") + " (" + $mode + "). Cancel = Ctrl+C.")

while ((Get-Date) -lt $target) {
  [void][QlAwake]::SetThreadExecutionState($flags)
  Start-Sleep -Seconds 60
}

[void][QlAwake]::SetThreadExecutionState($ES_CONTINUOUS)
Write-Output "DONE - power policy restored"
