# Porta il modello dalla T-pose a una posa naturale (braccia lungo i fianchi, gomiti e dita leggermente piegati).
# Da eseguire DOPO fix_model.py, UNA volta sola (non e' idempotente: la posa diventa la nuova rest pose):
#   Blender -b man-model.blend --python pose_natural.py -- man-model.blend
import bpy, sys, math
import numpy as np
from mathutils import Matrix, Vector

out = sys.argv[sys.argv.index("--")+1]
ARM_DOWN   = 72   # gradi: braccia da orizzontale (T-pose) verso il basso -> ~18 deg dalla verticale
ELBOW      = 12   # flessione del gomito (avanti)
CLAVICLE   = 4    # spalle leggermente abbassate
FINGER_CURL = 0.25  # rad per falange

arm = bpy.data.objects['MakeHuman default skeleton']
body = bpy.data.objects['firstmodelMesh']
eyes = bpy.data.objects['high-polyMesh']
A = arm.matrix_world.copy()
Ainv = A.inverted()

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')

def rot_world(name, axis, angle):
    """Ruota il pose bone attorno alla sua testa, con asse e angolo in spazio mondo."""
    pb = arm.pose.bones[name]
    Wb = A @ pb.matrix
    h = Wb.translation.copy()
    R = Matrix.Rotation(angle, 4, axis)
    Wn = Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ Wb
    pb.matrix = Ainv @ Wn
    bpy.context.view_layer.update()

for side, sgn in (('L', 1), ('R', -1)):
    rot_world(f'clavicle.{side}',  'Y', sgn*math.radians(CLAVICLE))
    rot_world(f'upperarm01.{side}','Y', sgn*math.radians(ARM_DOWN))
    rot_world(f'lowerarm01.{side}','X', -math.radians(ELBOW))
    # dita: leggera curvatura naturale (asse locale X del bone)
    for f in range(1, 6):
        for k in (1, 2, 3):
            n = f'finger{f}-{k}.{side}'
            if n in arm.pose.bones:
                arm.pose.bones[n].rotation_mode = 'XYZ'
                arm.pose.bones[n].rotation_euler[0] = FINGER_CURL * (1.0 if k > 1 else 0.6)
bpy.context.view_layer.update()
bpy.ops.object.mode_set(mode='OBJECT')

# ── Bake della posa nelle mesh (shape key comprese) ───────────────────────────
dg = bpy.context.evaluated_depsgraph_get()
def evaluated_coords(ob):
    dg.update()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    arr = np.empty(len(me.vertices)*3, np.float32)
    me.vertices.foreach_get('co', arr)
    ev.to_mesh_clear()
    return arr

keys = body.data.shape_keys.key_blocks
saved = [k.value for k in keys]
for k in keys: k.value = 0
baked = {}
baked['Basis'] = evaluated_coords(body)
for k in keys:
    if k.name == 'Basis': continue
    k.value = 1.0
    baked[k.name] = evaluated_coords(body)
    k.value = 0
eyes_co = evaluated_coords(eyes)

for k in keys:
    k.data.foreach_set('co', baked[k.name])
body.data.vertices.foreach_set('co', baked['Basis'])
eyes.data.vertices.foreach_set('co', eyes_co)
for k, v in zip(keys, saved): k.value = v
body.data.update(); eyes.data.update()

# ── La posa diventa la nuova posa di riposo dell'armatura ─────────────────────
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.wm.save_as_mainfile(filepath=out)
print("SAVED", out)
