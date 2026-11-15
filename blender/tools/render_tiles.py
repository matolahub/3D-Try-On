"""Render di controllo a riquadri (Workbench, ortografico) di corpo e/o capo. Da eseguire dentro Blender.

  Blender -b <file.blend> --python blender/tools/render_tiles.py -- spec.json

spec.json:
  { "out": "cartella", "size": [w, h], "views": ["front", "side", "back", "three"], "focus": [x, y, z], "extent": 1.9,
    "tiles": [ { "name": "neutro", "keys": {"Chest": 0.3, ...} },            influence degli shape key del corpo
               { "name": "x", "delta": ["file.npz", "chiave"] },             oppure spostamento mondo (m) per vertice
               { "name": "y", "keys": {...}, "glb": "capo.glb" } ] }         un capo (GLB, stesse coordinate del corpo) da mostrare indossato
  Una vista puo' anche essere un oggetto { "name": "collo", "dir": [x, y, z], "focus": [x, y, z], "extent": 0.4 }.
Scrive <out>/<name>_<view>.png e <out>/manifest.json (da comporre con compose_sheet.py, Python di sistema).
"""
import json
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

DIRS = {'front': (0, -1, 0), 'side': (1, 0, 0), 'back': (0, 1, 0), 'three': (-0.62, -0.75, 0.22), 'three_back': (0.62, 0.75, 0.22),
        'side_r': (-1, 0, 0), 'top': (0, -0.35, 1)}
BODY = 'firstmodelMesh'


def setup_scene(size):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'TEXTURE'
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
    sh.show_shadows = False
    sh.show_specular_highlight = True
    sc.display.render_aa = '8'
    if sc.world is None:
        sc.world = bpy.data.worlds.new('w')
    sc.world.color = (0.16, 0.16, 0.18)
    sc.view_settings.view_transform = 'Standard'
    cd = bpy.data.cameras.new('tile_cam')
    cd.type = 'ORTHO'
    cd.clip_end = 50
    cam = bpy.data.objects.new('tile_cam', cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def shoot(cam, view, focus, extent, path):
    if isinstance(view, dict):
        focus, extent = view.get('focus', focus), view.get('extent', extent)
        d = Vector(view['dir'] if 'dir' in view else DIRS[view.get('view', 'front')]).normalized()
    else:
        d = Vector(DIRS[view]).normalized()
    cam.data.ortho_scale = extent
    cam.location = Vector(focus) + d * 6
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    spec = json.load(open(sys.argv[sys.argv.index('--') + 1]))
    out = spec['out']
    os.makedirs(out, exist_ok=True)
    size = spec.get('size', [360, 640])
    cam = setup_scene(size)
    body = bpy.data.objects[BODY]
    me = body.data
    kb = me.shape_keys.key_blocks
    Rinv = np.linalg.inv(np.array(body.matrix_world)[:3, :3])
    base = np.empty(len(me.vertices) * 3, np.float32)
    kb['Basis'].data.foreach_get('co', base)
    tmp = body.shape_key_add(name='__tile', from_mix=False)
    views = spec.get('views', ['front', 'side', 'three'])
    man = {'size': size, 'views': [v['name'] if isinstance(v, dict) else v for v in views], 'tiles': []}
    cache = {}
    for t in spec['tiles']:
        for ob in bpy.data.objects:                      # gli occhi hanno lo shape key Altezza: ogni mesh riceve i valori che conosce
            if ob.type == 'MESH' and ob.data.shape_keys:
                for k in ob.data.shape_keys.key_blocks:
                    if k.name not in ('Basis', '__tile'):
                        k.slider_min, k.slider_max = -3, 3
                        k.value = float(t.get('keys', {}).get(k.name, 0.0))
        if 'delta' in t:
            f, key = t['delta']
            if f not in cache:
                cache[f] = np.load(f)
            d = cache[f][key] @ Rinv.T
            tmp.data.foreach_set('co', (base + d.astype(np.float32).ravel()))
            tmp.value = 1.0
        else:
            tmp.value = 0.0
        worn = []
        if t.get('glb'):
            before = set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=t['glb'])
            worn = [o for o in bpy.data.objects if o not in before]
            for o in worn:
                if o.type == 'MESH':
                    for m in o.data.materials:
                        m.use_backface_culling = False
        bpy.context.view_layer.update()
        for v in t.get('views', views):
            vn = v['name'] if isinstance(v, dict) else v
            p = os.path.join(out, f"{t['name']}_{vn}.png")
            shoot(cam, v, t.get('focus', spec.get('focus', [0, 0, 0.9])), t.get('extent', spec.get('extent', 1.9)), p)
        for o in worn:
            bpy.data.objects.remove(o, do_unlink=True)
        man['tiles'].append({'name': t['name'], 'label': t.get('label', t['name'])})
    json.dump(man, open(os.path.join(out, 'manifest.json'), 'w'), indent=1)
    print('TILES', len(man['tiles']), 'x', len(views), '->', out)


main()
