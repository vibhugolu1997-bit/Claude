#!/usr/bin/env bash
# Rebuilds public/assets/mahakali from the MIT-licensed Microsoft Rocketbox library.
# Requires: git, node/npm, python3 with numpy + pillow.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$(mktemp -d)}"
OUT="$ROOT/public/assets/mahakali"
CHAR="Assets/Avatars/Adults/Female_Adult_03"
mkdir -p "$OUT"

echo "→ sparse-cloning microsoft/Microsoft-Rocketbox ($CHAR)"
if [ ! -d "$WORK/rocketbox" ]; then
  git clone --depth 1 --filter=blob:none --no-checkout https://github.com/microsoft/Microsoft-Rocketbox "$WORK/rocketbox"
fi
git -C "$WORK/rocketbox" checkout HEAD -- "$CHAR" LICENSE.md

echo "→ converting FBX → GLB with FBX2glTF"
(cd "$WORK" && [ -d node_modules/fbx2gltf ] || npm i --no-save --prefix "$WORK" fbx2gltf@0.9.7p1 >/dev/null)
"$WORK/node_modules/fbx2gltf/bin/$(uname -s)/FBX2glTF" -b \
  -i "$WORK/rocketbox/$CHAR/Export/Female_Adult_03.fbx" -o "$WORK/f003"
cp "$WORK/f003.glb" "$OUT/body.glb"

echo "→ recolouring textures"
python3 "$ROOT/scripts/process_textures.py" "$WORK/rocketbox/$CHAR/Textures" "$OUT"
cp "$WORK/rocketbox/LICENSE.md" "$OUT/ROCKETBOX_LICENSE.md"
echo "✓ assets in $OUT"
