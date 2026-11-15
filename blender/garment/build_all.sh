#!/bin/sh
# Bake di tutte le taglie di un capo con un solo comando (una sim per taglia sul corpo neutro) + verifica dei criteri + contact sheet.
#   sh blender/garment/build_all.sh [taglie...]                      default: S M L XL 2XL, prodotto grillz-tee
#   PRODUCT=kermit-tee sh blender/garment/build_all.sh               un altro prodotto di blender/garment/products.py
# Log: blender/out/garment[/<prodotto>]/build_<taglia>.log, check_<taglia>.log. Variabili: PRODUCT, BLENDER, JOBS (bake in parallelo, default 2).
set -e
cd "$(dirname "$0")/../.."
B="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
PRODUCT="${PRODUCT:-grillz-tee}"
OUT=blender/out/garment
[ "$PRODUCT" = "grillz-tee" ] || OUT="$OUT/$PRODUCT"
DST="frontend/public/assets/garments/$PRODUCT"
SIZES="${*:-S M L XL 2XL}"
JOBS="${JOBS:-2}"
mkdir -p "$OUT" "$DST"
python3 blender/garment/prep_texture.py "$PRODUCT" > "$OUT/texture.log" 2>&1
n=0
for s in $SIZES; do
  ( "$B" -b blender/man-model.blend --python blender/garment/build_tee.py -- --product "$PRODUCT" --size "$s" > "$OUT/build_$s.log" 2>&1 \
      && echo "bake $s: $(grep -E 'ESPORTATO' "$OUT/build_$s.log" | sed 's/.*time //')" || { echo "bake $s: FALLITO (vedi $OUT/build_$s.log)"; } ) &
  n=$((n + 1))
  [ $((n % JOBS)) -eq 0 ] && wait
done
wait
fail=0
for s in $SIZES; do
  "$B" -b blender/man-model.blend --python blender/garment/check_tee.py -- --product "$PRODUCT" --size "$s" > "$OUT/check_$s.log" 2>&1 || fail=1
  grep -E "^(CHECK|  (OK|FAIL))" "$OUT/check_$s.log" || true
done
python3 blender/tools/garment_sheet.py --product "$PRODUCT" --sizes "$(echo $SIZES | awk '{print $1","$NF}')" --out "$OUT/sheet"
[ $fail -eq 0 ] && echo "Fatto: tutti i criteri rispettati" || { echo "ATTENZIONE: almeno un criterio non rispettato (vedi $OUT/check_*.log)"; exit 1; }
