@echo off
REM ==========================================================================
REM  Build phan mem thanh 1 file chay duy nhat: bin\BTKTPMUD.exe
REM  Yeu cau: Go 1.22 tro len (https://go.dev/dl/)
REM  Cach dung:  build.bat           -> chay kiem thu roi build
REM              build.bat run       -> build xong chay luon
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
endlocal
