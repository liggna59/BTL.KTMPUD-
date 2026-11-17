$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$python = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    throw 'Create .venv and install requirements.txt plus PyInstaller first. See README.md.'
}
& $python -m unittest discover -v
if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
& $python -m PyInstaller --noconfirm --clean --onefile --windowed --specpath build --name QuanLyBanHang main.py
if ($LASTEXITCODE -ne 0) { throw 'Executable build failed.' }
Copy-Item -LiteralPath 'sample_products.xlsx', 'README.md' -Destination 'dist' -Force
Compress-Archive -LiteralPath 'dist/QuanLyBanHang.exe', 'dist/sample_products.xlsx', 'dist/README.md' -DestinationPath 'dist/QuanLyBanHang-Windows.zip' -Force
Write-Output 'Ready: dist/QuanLyBanHang.exe and dist/QuanLyBanHang-Windows.zip'
