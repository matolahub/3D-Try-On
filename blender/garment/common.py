"""Strumenti condivisi per costruire il garment in Blender (corpo, pose, render di controllo).

Convenzioni (le stesse di blender/scripts/bodyspec.py): metri, Z verso l'alto, fronte verso -Y, X = sinistra del corpo (+X = .L).
Da eseguire dentro Blender:  Blender -b blender/man-model.blend --python <script> -- <args>
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BODY, ARM = 'firstmodelMesh', 'MakeHuman default skeleton'
# stesse rotazioni di blender/scripts/pose_natural.py (che porta il modello dalla T-pose alla posa naturale)
ARM_DOWN, ELBOW, CLAVICLE = 72, 12, 4


def script_args():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def body_objects():
    return bpy.data.objects[BODY], bpy.data.objects[ARM]


def evaluated_body(dg=None):
    """(vertici Nx3, triangoli Mx3) del corpo valutato (armatura + shape key), in coordinate mondo."""
    body, _ = body_objects()
    dg = dg or bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    n = len(me.vertices)
    co = np.empty(n * 3, np.float64)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    W = np.array(ev.matrix_world)
    co = co @ W[:3, :3].T + W[:3, 3]
    me.calc_loop_triangles()
    tris = np.array([t.vertices[:] for t in me.loop_triangles], np.int64)
    ev.to_mesh_clear()
    return co, tris


def _rot_world(arm, name, axis, angle):
    """Ruota il pose bone attorno alla propria testa (asse e angolo in spazio mondo), come in pose_natural.py."""
    A = arm.matrix_world.copy()
    pb = arm.pose.bones[name]
    Wb = A @ pb.matrix
    h = Wb.translation.copy()
    R = Matrix.Rotation(angle, 4, axis)
    Wn = Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ Wb
    pb.matrix = A.inverted() @ Wn
    bpy.context.view_layer.update()


def set_pose(pose, arm_below_horizontal=0.0):
    """pose = 'natural' (rest, invariata), 'tpose' (braccia orizzontali, inversa di pose_natural.py) oppure 'raised':
    braccia dritte a `arm_below_horizontal` gradi sotto l'orizzontale (la posa in cui il cartamodello steso combacia col corpo)."""
    body, arm = body_objects()
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()
    if pose in ('tpose', 'raised'):
        up = ARM_DOWN - (arm_below_horizontal if pose == 'raised' else 0.0)
        for side, sgn in (('L', 1), ('R', -1)):
            _rot_world(arm, f'lowerarm01.{side}', 'X', math.radians(ELBOW))
            _rot_world(arm, f'upperarm01.{side}', 'Y', -sgn * math.radians(up))
            _rot_world(arm, f'clavicle.{side}', 'Y', -sgn * math.radians(CLAVICLE * up / ARM_DOWN))
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()


def key_pose(frame):
    """Registra la posa corrente delle ossa come fotogramma chiave."""
    _, arm = body_objects()
    for pb in arm.pose.bones:
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        pb.keyframe_insert('location', frame=frame)


def load_calibration():
    import json
    with open(os.path.join(ROOT, 'frontend', 'src', 'bodyCalibration.json')) as f:
        return json.load(f)


def cm_to_influence(cal, cm):
    pts = cal['curve']
    x = max(cal['min'], min(cal['max'], cm))
    for i in range(1, len(pts)):
        if x <= pts[i][0]:
            (x0, y0), (x1, y1) = pts[i - 1], pts[i]
            return y0 + (x - x0) / (x1 - x0) * (y1 - y0)
    return pts[-1][1]


def set_body_keys(values):
    """values = {'Chest': influence, ...} (influence in [-1, 1]); le chiavi non citate vanno a 0."""
    body, _ = body_objects()
    for k in body.data.shape_keys.key_blocks:
        if k.name != 'Basis':
            k.value = values.get(k.name, 0.0)


def render(path, views=('front', 'side', 'back', 'three'), size=720, objects=None, focus=None, extent=1.0):
    """Render di controllo (Workbench, ortografico). focus=(x,y,z) centro vista, extent = altezza vista (m)."""
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x = scene.render.resolution_y = size
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'TEXTURE'
    if scene.world is None:
        scene.world = bpy.data.worlds.new('w')
    scene.world.color = (0.18, 0.18, 0.2)
    cam_data = bpy.data.cameras.new('cc')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = extent
    cam_data.clip_end = 50
    cam = bpy.data.objects.new('cc', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cx, cy, cz = focus or (0, 0, 0.9)
    dirs = {'front': (0, -1, 0), 'side': (1, 0, 0), 'back': (0, 1, 0), 'three': (-0.6, -0.8, 0.25)}
    hidden = []
    if objects is not None:
        for o in bpy.data.objects:
            if o.type == 'MESH':
                hidden.append((o, o.hide_render))
                o.hide_render = o not in objects
    out = []
    for v in views:
        d = Vector(dirs[v]).normalized()
        cam.location = Vector((cx, cy, cz)) + d * 6
        cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        p = f'{path}_{v}.png'
        scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        out.append(p)
    for o, h in hidden:
        o.hide_render = h
    bpy.data.objects.remove(cam)
    return out
