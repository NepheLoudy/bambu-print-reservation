' qianli dashboard keepalive: hidden-runs dashboard\autostart.bat (port-guarded, idempotent)
' Invoked every 10 minutes by scheduled task "qianli-dashboard-keepalive"
' Path resolved per machine (2026-10-14 v154): desktop D:\dev / laptop C:\Users\0d00\Desktop
Dim sh, fso, bat
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
bat = "D:\dev\qianli\dashboard\autostart.bat"
If Not fso.FileExists(bat) Then bat = "C:\Users\0d00\Desktop\qianli\dashboard\autostart.bat"
sh.Run """" & bat & """", 0, False
