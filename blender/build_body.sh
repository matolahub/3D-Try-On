#!/bin/sh
# Ricostruisce il CORPO con un solo comando: shape key calibrati -> verifica delle misure -> GLB per il frontend -> contact sheet.
#   sh blender/build_body.sh
# Variabili: BLENDER (eseguibile di Blender 4.5), default /Applications/Blender.app/Contents/MacOS/Blender
set -e
cd "$(dirname "$0")/.."
B="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
OUT=blender/out/body
mkdir -p "$OUT"
echo "1/4 shape key (riferimento anatomico: blender/scripts/data/mh_reference.npz)"
"$B" -b blender/man-model.blend --python blender/scripts/build_shape_keys.py -- blender/man-model.blend frontend/src/bodyCalibration.json > "$OUT/build.log" 2>&1 || { tail -30 "$OUT/build.log"; exit 1; }
grep -E "^(BASE|CAL|BRACCIA|RIFERIMENTO)" "$OUT/build.log"
echo "2/4 verifica delle misure (blender/scripts/measure_body.py)"
"$B" -b blender/man-model.blend --python blender/scripts/measure_body.py > "$OUT/measure.log" 2>&1 || { grep -E "FAIL|RISULTATO|Error" "$OUT/measure.log"; exit 1; }
grep -E "RISULTATO" "$OUT/measure.log"
echo "3/4 GLB"
"$B" -b blender/man-model.blend --python blender/scripts/export_glb.py -- frontend/public/assets/man-model.glb > "$OUT/export.log" 2>&1
grep -E "EXPORTED" "$OUT/export.log"
echo "4/4 contact sheet"
BLENDER="$B" python3 blender/tools/body_sheet.py --out "$OUT"
echo "Fatto: $OUT/body_full.png, $OUT/body_torso.png, $OUT/measure.log"
