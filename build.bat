@echo off
REM ==========================================================================
REM  Build phan mem thanh 1 file chay duy nhat: bin\BTKTPMUD.exe
REM  Yeu cau: Go 1.22 tro len (https://go.dev/dl/)
REM  Cach dung:  build.bat           -> chay kiem thu roi build
REM              build.bat run       -> build xong chay luon
REM              build.bat zip       -> build xong dong goi dist\BTKTPMUD-windows.zip de gui nguoi khac
REM ==========================================================================
setlocal
cd /d "%~dp0"
chcp 65001 >nul

where go >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua cai Go. Tai tai https://go.dev/dl/ roi chay lai build.bat
  exit /b 1
)

set VERSION=1.0.0
for /f %%i in ('git rev-parse --short HEAD 2^>nul') do set VERSION=1.0.0-%%i

echo == Kiem thu backend (go test) ==
go test ./internal/...
if errorlevel 1 (
  echo [LOI] Kiem thu that bai, dung build.
  exit /b 1
)

echo == Build bin\BTKTPMUD.exe (phien ban %VERSION%) ==
if not exist bin mkdir bin
go build -trimpath -ldflags "-s -w -X main.Version=%VERSION%" -o bin\BTKTPMUD.exe .\cmd\server
if errorlevel 1 (
  echo [LOI] Build that bai.
  exit /b 1
)
echo.
echo Xong! File chay: bin\BTKTPMUD.exe
echo Sao chep BTKTPMUD.exe cung thu muc data\ sang may ban hang roi bam dup de chay.

if /i "%1"=="run" (
  bin\BTKTPMUD.exe
)

if /i "%1"=="zip" (
  echo == Dong goi dist\BTKTPMUD-windows.zip ==
  if exist dist\package rmdir /s /q dist\package
  mkdir dist\package\data
  copy /y bin\BTKTPMUD.exe dist\package\ >nul
  copy /y data\*.json dist\package\data\ >nul
  copy /y docs\HUONG_DAN_SU_DUNG.txt dist\package\ >nul
  powershell -NoProfile -Command "Compress-Archive -Path 'dist\package\*' -DestinationPath 'dist\BTKTPMUD-windows.zip' -Force"
  rmdir /s /q dist\package
  echo Xong! Gui file dist\BTKTPMUD-windows.zip cho nguoi can dung.
)
endlocal
