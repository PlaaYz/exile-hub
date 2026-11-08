; Moving from the Electron build (0.2.x) to the Tauri build: before installing, silently remove the
; old Electron install (%LOCALAPPDATA%\Programs\exile-hub). User data (%APPDATA%\exile-hub) is shared
; by both builds and is kept. A "start with Windows" entry of the old build is carried over.

!macro NSIS_HOOK_PREINSTALL
  StrCpy $R0 "$LOCALAPPDATA\Programs\exile-hub"
  IfFileExists "$R0\Uninstall Exile Hub.exe" 0 eh_no_electron
    DetailPrint "Removendo a versao anterior (Electron)..."
    ; _?= keeps the uninstaller from copying itself to %TEMP%, so ExecWait really waits
    ExecWait '"$R0\Uninstall Exile Hub.exe" /currentuser /S _?=$R0'
    Delete "$R0\Uninstall Exile Hub.exe"
    RMDir "$R0"
  eh_no_electron:

  ReadRegStr $R1 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Exile Hub"
  StrCmp $R1 "" eh_no_autostart
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Exile Hub"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Exile Hub" '"$INSTDIR\${MAINBINARYNAME}.exe" --hidden'
  eh_no_autostart:
!macroend

; electron-updater (0.2.x) runs this installer with "--updated /S --force-run" for "Reiniciar e
; atualizar": start the new app like the old installer did (Tauri's own flag for this is /R).
!macro NSIS_HOOK_POSTINSTALL
  ClearErrors
  ${GetOptions} $CMDLINE "--force-run" $R0
  IfErrors eh_no_force_run
    Exec '"$INSTDIR\${MAINBINARYNAME}.exe"'
  eh_no_force_run:
!macroend
