#!/usr/bin/env sh
# Build phần mềm thành 1 file chạy duy nhất (Linux / macOS / Git Bash).
#   ./build.sh            -> kiểm thử rồi build bin/BTKTPMUD (bin/BTKTPMUD.exe trên Windows)
#   ./build.sh all        -> build thêm bản cho Windows, Linux, macOS vào dist/
#   ./build.sh run        -> build xong chạy luôn
set -e
cd "$(dirname "$0")"

VERSION="1.0.0"
if command -v git >/dev/null 2>&1 && git rev-parse --short HEAD >/dev/null 2>&1; then
  VERSION="1.0.0-$(git rev-parse --short HEAD)"
fi
LDFLAGS="-s -w -X main.Version=$VERSION"

echo "== Kiểm thử backend (go test) =="
go test ./internal/...

EXE="bin/BTKTPMUD$(go env GOEXE)"
echo "== Build $EXE (phiên bản $VERSION) =="
mkdir -p bin
go build -trimpath -ldflags "$LDFLAGS" -o "$EXE" ./cmd/server

if [ "$1" = "all" ]; then
  mkdir -p dist
  for target in windows/amd64 linux/amd64 darwin/amd64 darwin/arm64; do
    os=${target%/*}; arch=${target#*/}
    out="dist/BTKTPMUD-$os-$arch"
    [ "$os" = "windows" ] && out="$out.exe"
    echo "   -> $out"
    GOOS=$os GOARCH=$arch go build -trimpath -ldflags "$LDFLAGS" -o "$out" ./cmd/server
  done
fi

echo "Xong! File chạy: $EXE"
if [ "$1" = "run" ]; then
  "./$EXE"
fi
