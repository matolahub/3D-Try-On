#!/bin/sh
# Rifinitura (senza sim) + controlli in sandbox: sh blender/garment/refinish_all.sh <tag> "prodotto:taglia ..."   (parte dalle sim installate in blender/out/garment)
cd "$(dirname "$0")/../.."
tag=$1; list=$2
mkdir -p blender/out/eval/work; n=0
for it in $list; do
  p=${it%%:*}; s=${it##*:}
  ( sh blender/garment/sandbox.sh $tag $p $s --refinish > blender/out/eval/work/.$tag.$p.$s.out 2>&1 ) &
  n=$((n+1)); [ $((n % ${JOBS:-3})) -eq 0 ] && wait
done; wait
for it in $list; do p=${it%%:*}; s=${it##*:}; echo "== $p $s"; grep -E "colletto finale|SCARTATO|CHECK [T0-9]|FAIL|Error|Traceback" blender/out/eval/work/.$tag.$p.$s.out | cut -c1-200; done
echo ALLDONE
