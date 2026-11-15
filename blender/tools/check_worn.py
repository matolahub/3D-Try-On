"""Distanza VERA dal corpo di un capo adattato a runtime (GLB scritto da frontend/scripts/deform-asset.mjs). Da eseguire dentro Blender.

  Blender -b blender/man-model.blend --python blender/tools/check_worn.py -- capo.glb "Chest=0.71,Waist=0.4" [altro.glb "..."]
Per ogni coppia (GLB, influence degli shape key del corpo) stampa distanza minima con segno, vertici dentro il corpo e sotto 1 mm.
"""
import os
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'garment'))
import common as C  # noqa: E402

a = C.script_args()
for glb, keys in zip(a[0::2], a[1::2]):
    C.set_body_keys({kv.split('=')[0]: float(kv.split('=')[1]) for kv in keys.split(',') if '=' in kv})
    bpy.context.view_layer.update()
    bco, btr = C.evaluated_body()
    tree = BVHTree.FromPolygons([tuple(v) for v in bco], [tuple(t) for t in btr])
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb)
    d = []
    for o in [o for o in bpy.data.objects if o not in before]:
        if o.type == 'MESH':
            W = o.matrix_world
            for v in o.data.vertices:
                p = W @ v.co
                loc, nrm, _, dist = tree.find_nearest(p)
                d.append(dist if (p - loc).dot(nrm) >= 0 else -dist)
        bpy.data.objects.remove(o, do_unlink=True)
    d = np.array(d) * 1000
    print(f'WORN {os.path.basename(glb):34s} min {d.min():6.2f} mm  dentro il corpo {(d < 0).sum():4d}  sotto 1 mm {(d < 1).sum():4d}  su {len(d)} vertici')
