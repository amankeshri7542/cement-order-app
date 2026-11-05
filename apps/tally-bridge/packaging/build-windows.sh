#!/bin/sh
# Makes the folder and zip Aman carries to the shop PC, on this Mac. It cross-builds nothing: the only
# Windows binary in it is Node's own node.exe, which you download and check yourself (see the README).
# Usage: build-windows.sh --update-key update-key.pub [--node path/to/node.exe] [--out dist]
set -eu
HERE=$(cd "$(dirname "$0")/.." && pwd)
OUT="$HERE/dist"
NODE_EXE=""
KEY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --node) NODE_EXE=$2; shift 2 ;;
    --update-key) KEY=$2; shift 2 ;;
    --out) OUT=$2; shift 2 ;;
    *) echo "Unknown option $1" >&2; exit 2 ;;
  esac
done
[ -n "$KEY" ] || { echo "Give --update-key: the public half of the offline update key." >&2; exit 2; }
VERSION=$(sed -n "s/^export const AGENT_VERSION = '\(.*\)';$/\1/p" "$HERE/src/version.mjs")
[ -n "$VERSION" ] || { echo "Could not read src/version.mjs" >&2; exit 1; }
DEST="$OUT/ShivBridge-$VERSION"
rm -rf "$DEST"
mkdir -p "$DEST/app"
cp "$HERE"/src/*.mjs "$DEST/app/"
cp "$KEY" "$DEST/app/update-key.pub"
cp "$HERE/packaging/install.cmd" "$HERE/packaging/uninstall.cmd" "$HERE/packaging/ShivTallyCheck.cmd" "$DEST/"
# schtasks reads a task file as UTF-16 with its byte-order mark, as Windows itself writes them.
{
  printf '\377\376'
  sed 's/encoding="UTF-8"/encoding="UTF-16"/' "$HERE/packaging/ShivBridge-task.xml" | iconv -f UTF-8 -t UTF-16LE
} > "$DEST/ShivBridge-task.xml"
if [ -n "$NODE_EXE" ]; then
  cp "$NODE_EXE" "$DEST/node.exe"
else
  echo "No --node given: the folder has no node.exe yet, and will not run until it does." >&2
fi
( cd "$OUT" && rm -f "ShivBridge-$VERSION.zip" && zip -qr "ShivBridge-$VERSION.zip" "ShivBridge-$VERSION" )
echo "$OUT/ShivBridge-$VERSION.zip"
