; NSIS pre-install hooks für Syncomat.
;
; Problem: Windows kann eine laufende .exe nicht überschreiben (file-lock).
; Wenn Syncomat im Tray läuft (was per Design — Window-Close hidet nur),
; scheitert der NSIS-Installer mit "Error opening file for writing: syncthing.exe".
;
; Lösung: vor dem Schreibvorgang die alte App + ihren Syncthing-Sidecar killen.
; Wir nutzen taskkill /F (force) damit auch nicht-respondierende Instanzen weg sind.
; Sleep danach gibt dem File-System Zeit den Lock freizugeben.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping running Syncomat instances…"
  nsExec::ExecToLog 'taskkill /F /IM "syncomat.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "syncthing.exe" /T'
  Sleep 1500
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping Syncomat before uninstall…"
  nsExec::ExecToLog 'taskkill /F /IM "syncomat.exe" /T'
  nsExec::ExecToLog 'taskkill /F /IM "syncthing.exe" /T'
  Sleep 1500
!macroend
