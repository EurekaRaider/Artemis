!macro customInstall
  FileOpen $0 "$INSTDIR\resources\distribution.json" w
  FileWrite $0 '{"distribution":"nsis","arch":"x64"}'
  FileClose $0
!macroend
