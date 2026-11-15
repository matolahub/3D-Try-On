#!/bin/sh
# Installa nel frontend i capi costruiti in una sandbox (blender/garment/sandbox.sh, refinish_all.sh): GLB + JSON negli asset,
# archivi e log in blender/out/garment (li usa check_tee.py). Prima salva una copia degli asset correnti.
#   sh blender/garment/install.sh <tag> "prodotto:taglia prodotto:taglia ..."
cd "$(dirname "$0")/../.."
tag=$1; list=$2
bk=blender/out/backup_$(date +%m%d_%H%M)_garments
cp -R frontend/public/assets/garments "$bk" && echo "copia degli asset correnti: $bk"
for it in $list; do
  p=${it%%:*}; s=${it##*:}
  W=blender/out/eval/work/$tag/$p
  dst=blender/out/garment; [ "$p" = grillz-tee ] || dst=$dst/$p
  if grep -q ESPORTATO "$W/build_$s.log" 2>/dev/null; then
    mkdir -p "$dst" "frontend/public/assets/garments/$p"
    cp "$W/tee-$s.glb" "$W/tee-$s.json" "frontend/public/assets/garments/$p/"
    cp "$W/tee_${s}_build.npz" "$W/build_$s.log" "$W/check_$s.log" "$dst/"
    [ -f "$W/tee_${s}_sim.npz" ] && cp "$W/tee_${s}_sim.npz" "$dst/"
    echo "INSTALLATA $p $s: $(grep -E '^CHECK [T0-9]' "$W/check_$s.log")"
  else
    echo "SALTATA $p $s: nessun GLB esportato in $W"
  fi
done
