' qianli dashboard keepalive: hidden-runs dashboard\autostart.bat (port-guarded, idempotent)
' Invoked every 10 minutes by scheduled task "qianli-dashboard-keepalive"
CreateObject("WScript.Shell").Run """C:\Users\0d00\Desktop\qianli\dashboard\autostart.bat""", 0, False
