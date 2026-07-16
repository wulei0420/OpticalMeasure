Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir
WshShell.Run "cmd /c start.bat", 0, False

WScript.Sleep 5000

On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP")
http.Open "GET", "http://localhost:5002/api/status", False
http.setTimeout 3000, 3000, 3000, 3000
http.Send

If Err.Number <> 0 Or http.Status <> 200 Then
    msg = "OpticalMeasure did not start correctly." & vbCrLf & vbCrLf
    msg = msg & "Run start.bat directly to see error details."
    WshShell.Popup msg, 15, "Startup Error", 48
Else
    WshShell.Run "http://localhost:5002"
End If
