#!/usr/bin/env bash
# Fresh distributable ZIP; Git sources include only tracked, allowlisted files.
# Without .git, only explicitly allowed source patterns can be repackaged.
# Usage: bash scripts/package_skill.sh [output-directory]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
DIST="${1:-$ROOT/dist}"
for tool in node zip unzip; do
  command -v "$tool" >/dev/null 2>&1 || { printf 'missing required tool: %s\n' "$tool" >&2; exit 1; }
done
mkdir -p "$DIST"
DIST="$(cd "$DIST" && pwd -P)" # Relative output paths must survive the stage cd.
case "$DIST/" in
  "$ROOT/scripts/"*|"$ROOT/references/"*|"$ROOT/assets/"*|"$ROOT/examples/"*|"$ROOT/.git/"*|"$ROOT/.github/"*)
    printf 'output directory must not overwrite source directories\n' >&2; exit 1 ;;
esac
OUT="$DIST/skill.zip"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/shenti-coach.XXXXXX")"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

VERSION="$(node -e 'const fs=require("fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version)' "$ROOT/package.json")"
STAGE_SKILL="$STAGE/shenti-coach"
mkdir -p "$STAGE_SKILL"
# Save first so a manifest/Git failure cannot be lost in process substitution.
node "$ROOT/scripts/verify_package.mjs" --manifest "$ROOT" > "$STAGE/manifest"
while IFS= read -r -d '' file; do
  mkdir -p "$STAGE_SKILL/$(dirname "$file")"
  cp "$ROOT/$file" "$STAGE_SKILL/$file"
done < "$STAGE/manifest"
printf '%s\n' "$VERSION" > "$STAGE_SKILL/VERSION"
# The published ZIP must show its own version even before main's badge dispatch.
node "$STAGE_SKILL/scripts/make_badge.mjs" release "v$VERSION" "$STAGE_SKILL/assets/badges/release.svg" blue
node "$ROOT/scripts/verify_package.mjs" "$STAGE_SKILL" --version "$VERSION"

# Never update an existing archive: zip would otherwise retain deleted entries.
( cd "$STAGE" && zip -qr skill.zip shenti-coach )
unzip -t "$STAGE/skill.zip" >/dev/null
if command -v sha256sum >/dev/null 2>&1; then
  ( cd "$STAGE" && sha256sum skill.zip > skill.zip.sha256 )
else
  ( cd "$STAGE" && shasum -a 256 skill.zip > skill.zip.sha256 )
fi
mv "$STAGE/skill.zip" "$OUT"
mv "$STAGE/skill.zip.sha256" "$OUT.sha256"
printf 'built: %s\nversion: %s\n' "$OUT" "$VERSION"
