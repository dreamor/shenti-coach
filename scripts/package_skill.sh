#!/usr/bin/env bash
# 构建可分发的 skill.zip：解压后得到 shenti-coach/ 目录。
# 用法: bash scripts/package_skill.sh [输出目录]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="${1:-$ROOT/dist}"
OUT="$DIST/skill.zip"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/shenti-coach.XXXXXX")"

cleanup() {
  rm -r "$STAGE"
}
trap cleanup EXIT

VERSION="$(node -e 'const fs=require("fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version)' "$ROOT/package.json")"
STAGE_SKILL="$STAGE/shenti-coach"

mkdir -p "$STAGE_SKILL" "$DIST"
cp "$ROOT/SKILL.md" "$ROOT/README.md" "$ROOT/LICENSE" "$ROOT/package.json" "$STAGE_SKILL/"
cp -R "$ROOT/references" "$ROOT/scripts" "$ROOT/examples" "$STAGE_SKILL/"
printf '%s\n' "$VERSION" > "$STAGE_SKILL/VERSION"

# 不把本机缓存或渲染中间产物打进发布包。
find "$STAGE_SKILL" -name '.DS_Store' -delete
find "$STAGE_SKILL/examples" -name '*.html' -delete

( cd "$STAGE" && zip -qr "$OUT" shenti-coach )

unzip -t "$OUT" >/dev/null
unzip -p "$OUT" shenti-coach/SKILL.md >/dev/null
unzip -p "$OUT" shenti-coach/scripts/vendor/mermaid.min.js >/dev/null

if command -v sha256sum >/dev/null 2>&1; then
  ( cd "$DIST" && sha256sum skill.zip > skill.zip.sha256 )
else
  ( cd "$DIST" && shasum -a 256 skill.zip > skill.zip.sha256 )
fi

echo "built: $OUT"
echo "version: $VERSION"
echo "sha256: $(cut -d' ' -f1 "$OUT.sha256")"
