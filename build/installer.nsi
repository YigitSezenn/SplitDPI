; SplitDPI kurulum betiği (NSIS 3, Unicode)
; Derleme: npm run dist  (veya: npm run pack && npm run installer)
Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!include "MUI2.nsh"
!include "FileFunc.nsh"

!define APPNAME "SplitDPI"
!define EXE "SplitDPI.exe"
!define APPID "com.yigit.splitdpi"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPID}"
!define LEGACY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.yigit.gecit"

Name "${APPNAME}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\SplitDPI"
InstallDirRegKey HKCU "Software\${APPID}" "InstallDir"
RequestExecutionLevel user
BrandingText "${APPNAME} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1055 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=1055 "CompanyName" "Süleyman Yiğit Sezen"
VIAddVersionKey /LANG=1055 "FileDescription" "${APPNAME} Kurulum"
VIAddVersionKey /LANG=1055 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1055 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1055 "LegalCopyright" "MIT Lisansı"

!define MUI_ICON "..\assets\icon.ico"
!define MUI_UNICON "..\assets\icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "${APPNAME} ${VERSION} kurulumu"
!define MUI_WELCOMEPAGE_TEXT "SplitDPI, DPI ile engellenen sitelere erişmeni sağlar. Trafiğin bilgisayarında bölünür; herhangi bir sunucuya yönlendirilmez, sürücü yüklenmez.$\r$\n$\r$\nKurulum için yönetici izni gerekmez."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "SplitDPI'ı başlat"
!define MUI_FINISHPAGE_LINK "Proje sayfası"
!define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/YigitSezenn/splitdpi"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Turkish"

!macro KillApp
  nsExec::Exec 'taskkill /IM "${EXE}" /F'
  nsExec::Exec 'taskkill /IM "Gecit.exe" /F'
  Sleep 600
!macroend

!macro ResetProxy
  ; Uygulama açık kaldıysa sistem proxy'sini kapat (internet bağlantısı kesilmesin)
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Internet Settings" "ProxyServer"
  StrCpy $1 $0 10
  StrCmp $1 "127.0.0.1:" 0 +2
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Internet Settings" "ProxyEnable" 0
!macroend

Section "SplitDPI" SecMain
  SectionIn RO
  !insertmacro KillApp

  ; Önceki ad ("Geçit") ile kurulmuş sürümü sessizce kaldır
  ReadRegStr $2 HKCU "${LEGACY_KEY}" "UninstallString"
  StrCmp $2 "" +3
    ExecWait '$2 /S'
    DeleteRegKey HKCU "${LEGACY_KEY}"

  SetOutPath "$INSTDIR"
  File /r "${SRC}\*.*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortCut "$SMPROGRAMS\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0

  WriteRegStr HKCU "Software\${APPID}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "Süleyman Yiğit Sezen"
  WriteRegStr HKCU "${UNINST_KEY}" "URLInfoAbout" "https://github.com/YigitSezenn/splitdpi"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" $0
SectionEnd

Section "Uninstall"
  !insertmacro KillApp
  !insertmacro ResetProxy
  ; Windows ile başlat kayıtlarını sil
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APPID}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APPNAME}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.${APPNAME}"

  Delete "$SMPROGRAMS\${APPNAME}.lnk"
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\${APPID}"
SectionEnd
