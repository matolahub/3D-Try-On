#!/bin/sh
# Prova in SANDBOX (non tocca gli asset installati): sh blender/garment/sandbox.sh <tag> <prodotto> <taglia> [args extra di build_tee, es. --refinish]
# copia la sim salvata nella cartella di lavoro e scrive GLB/npz li' (gli asset veri non vengono toccati)
cd "$(dirname "$0")/../.."
tag=$1; p=$2; s=$3; shift 3
W=blender/out/eval/work/$tag
src=blender/out/garment; [ "$p" = grillz-tee ] || src=$src/$p
mkdir -p $W/$p
[ -f $W/$p/tee_${s}_sim.npz ] || cp $src/tee_${s}_sim.npz $W/$p/
[ -f $W/$p/tee-$s.json ] || cp frontend/public/assets/garments/$p/tee-$s.json $W/$p/
B=/Applications/Blender.app/Contents/MacOS/Blender
$B -b blender/man-model.blend --python blender/garment/build_tee.py -- --product $p --size $s --out $W/$p --glb $W/$p/tee-$s.glb "$@" > $W/$p/build_$s.log 2>&1
grep -E "^TEE (colletto|auto-intersezioni del|rifinitura|ESPORTATO)|Error|Traceback" $W/$p/build_$s.log | cut -c1-330
$B -b blender/man-model.blend --python blender/garment/check_tee.py -- --product $p --size $s --out $W/$p --glb $W/$p/tee-$s.glb > $W/$p/check_$s.log 2>&1
grep -E "^(CHECK [T0-9]|  FAIL)" $W/$p/check_$s.log | cut -c1-200
