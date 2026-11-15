#!/bin/sh
# Bake + controlli + installazione, una taglia alla volta per lavoro (JOBS in parallelo). Ogni taglia viene installata appena esportata.
#   sh blender/garment/bake_install.sh <tag> "prodotto:taglia prodotto:taglia ..."
cd "$(dirname "$0")/../.."
tag=$1; list=$2
mkdir -p blender/out/eval/work
one() {
  p=${1%%:*}; s=${1##*:}
  W=blender/out/eval/work/$tag/$p
  sh blender/garment/sandbox.sh $tag $p $s > blender/out/eval/work/.$tag.$p.$s.out 2>&1
  if grep -q "ESPORTATO" $W/build_$s.log 2>/dev/null && [ -f $W/check_$s.log ]; then
    dst=blender/out/garment; [ "$p" = grillz-tee ] || dst=$dst/$p
    mkdir -p $dst frontend/public/assets/garments/$p
    cp $W/tee-$s.glb $W/tee-$s.json frontend/public/assets/garments/$p/
    cp $W/tee_${s}_sim.npz $W/tee_${s}_build.npz $W/build_$s.log $W/check_$s.log $dst/
    echo "$(date +%H:%M) INSTALLATA $p $s: $(grep -E '^CHECK [T0-9]' $W/check_$s.log) $(grep -E '^  FAIL' $W/check_$s.log | cut -c1-70 | tr '\n' ';')"
  else
    echo "$(date +%H:%M) FALLITA $p $s (vedi $W/build_$s.log)"
  fi
}
n=0
for it in $list; do
  one $it &
  n=$((n+1)); [ $((n % ${JOBS:-2})) -eq 0 ] && wait
done
wait
echo ALLDONE
