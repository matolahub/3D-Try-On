# Correzioni applicate a man-model.blend (normali, materiali pelle/occhi, UV occhi).
# Da eseguire UNA volta sul .blend originale (non e' idempotente):
#   Blender -b man-model.blend --python fix_model.py -- man-model.blend
import bpy, sys, math
import numpy as np
out = sys.argv[sys.argv.index("--")+1]

body = bpy.data.objects['firstmodelMesh']
eyes = bpy.data.objects['high-polyMesh']

# ── 1. Normali: via bordi sharp e normali custom importate, poi smooth ─────────
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.mesh.customdata_custom_splitnormals_clear()
for ob in (body, eyes):
    me = ob.data
    for name in ('sharp_edge', 'sharp_face'):
        if name in me.attributes: me.attributes.remove(me.attributes[name])
    me.polygons.foreach_set('use_smooth', [True]*len(me.polygons))
    me.update()
bpy.context.view_layer.objects.active = eyes
eyes.select_set(True); body.select_set(False)
bpy.ops.mesh.customdata_custom_splitnormals_clear()

# ── 2. Pelle ──────────────────────────────────────────────────────────────────
def clean_normal_node(mat):
    nt = mat.node_tree
    for n in [n for n in nt.nodes if n.type == 'NORMAL_MAP']:
        nt.nodes.remove(n)

skin = bpy.data.materials['firstmodel']
clean_normal_node(skin)
b = skin.node_tree.nodes['Principled BSDF']
b.inputs['Base Color'].default_value = (0.62, 0.40, 0.30, 1.0)
b.inputs['Metallic'].default_value = 0.0
b.inputs['Roughness'].default_value = 0.55
b.inputs['Specular IOR Level'].default_value = 0.35
b.inputs['Subsurface Weight'].default_value = 0.25
b.inputs['Subsurface Radius'].default_value = (1.0, 0.35, 0.2)
b.inputs['Subsurface Scale'].default_value = 0.01

# ── 3a. Occhi: separa cornea (guscio esterno) e bulbo, rimappa UV del bulbo ────
eme = eyes.data
uvd = eme.uv_layers[0].data
parent = list(range(len(eme.polygons)))
def find(a):
    while parent[a] != a:
        parent[a] = parent[parent[a]]; a = parent[a]
    return a
vf = {}
for p in eme.polygons:
    for v in p.vertices: vf.setdefault(v, []).append(p.index)
for fl in vf.values():
    for x in fl[1:]: parent[find(x)] = find(fl[0])
islands = {}
for p in eme.polygons: islands.setdefault(find(p.index), []).append(p)
cornea_polys = []
for ps in islands.values():
    uvs = np.array([uvd[li].uv[:] for p in ps for li in p.loop_indices])
    lo, hi = uvs.min(0), uvs.max(0)
    if lo[0] > 0.85 and lo[1] < 0.15 and (hi-lo).max() < 0.15:   # guscio cornea (isola piccola nell'angolo)
        cornea_polys += ps
        for p in ps:
            for li in p.loop_indices: uvd[li].uv = (0.5, 0.5)
    else:                                                       # bulbo: riempie 0..1
        side = (hi-lo).max(); c = (lo+hi)/2
        for p in ps:
            for li in p.loop_indices:
                uvd[li].uv = (np.array(uvd[li].uv[:]) - c)/side + 0.5

# ── 3. Occhi: texture procedurale (il file brown_eye.png non esiste) ──────────
N = 512
y, x = np.mgrid[0:N, 0:N]
cx = cy = (N-1)/2
r = np.hypot(x-cx, y-cy) / (N/2)          # 0 centro → 1 bordo
ang = np.arctan2(y-cy, x-cx)
img = np.ones((N, N, 4), np.float32)
sclera = np.array([0.93, 0.91, 0.89])
iris_in = np.array([0.42, 0.24, 0.09]); iris_out = np.array([0.20, 0.10, 0.04])
streak = 0.5 + 0.5*np.sin(ang*38) * np.sin(ang*11+r*6)
col = np.tile(sclera, (N, N, 1))
iris_r = 0.38
t = np.clip(r/iris_r, 0, 1)[..., None]
iris = iris_in*(1-t) + iris_out*t
iris = iris * (0.85 + 0.3*streak[..., None]*(1-t*0.4))
m_iris = (r < iris_r)[..., None]
col = np.where(m_iris, iris, col)
limbal = np.clip((r-iris_r+0.04)/0.04, 0, 1)*(r < iris_r+0.0)   # anello scuro al bordo iride
col = np.where((r < iris_r)[..., None], col*(1-0.6*np.clip((r-iris_r*0.82)/(iris_r*0.18), 0, 1)[..., None]), col)
pupil = (r < 0.15)[..., None]
col = np.where(pupil, np.array([0.01, 0.01, 0.01]), col)
img[..., :3] = col
# vena leggera sulla sclera vicino ai bordi
edge = np.clip((r-0.85)/0.15, 0, 1)[..., None]
img[..., :3] = img[..., :3]*(1-0.12*edge) + np.array([0.6, 0.35, 0.33])*(0.12*edge)*(r >= iris_r)[..., None]
tex = bpy.data.images.new("eye_procedural", N, N, alpha=False)
tex.pixels.foreach_set(img.ravel())
tex.pack()
tex.colorspace_settings.name = 'sRGB'

eye_mat = bpy.data.materials['high-poly']
clean_normal_node(eye_mat)
nt = eye_mat.node_tree
for n in [n for n in nt.nodes if n.type == 'TEX_IMAGE']:
    nt.nodes.remove(n)
tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = tex; tn.location = (-400, 0)
eb = nt.nodes['Principled BSDF']
for l in list(nt.links):
    if l.to_socket.name == 'Alpha': nt.links.remove(l)
nt.links.new(tn.outputs['Color'], eb.inputs['Base Color'])
eb.inputs['Metallic'].default_value = 0.0
eb.inputs['Roughness'].default_value = 0.12
eb.inputs['Specular IOR Level'].default_value = 0.8
eye_mat.blend_method = 'OPAQUE'

cornea = bpy.data.materials.new('cornea'); cornea.use_nodes = True
cb = cornea.node_tree.nodes['Principled BSDF']
cb.inputs['Base Color'].default_value = (1, 1, 1, 1)
cb.inputs['Metallic'].default_value = 0.0
cb.inputs['Roughness'].default_value = 0.03
cb.inputs['Alpha'].default_value = 0.12
cb.inputs['Specular IOR Level'].default_value = 0.5
cornea.blend_method = 'BLEND'
eyes.data.materials.append(cornea)
for p in cornea_polys: p.material_index = 1

for i in list(bpy.data.images):
    if i.name.startswith('brown_eye'): bpy.data.images.remove(i)

bpy.ops.wm.save_as_mainfile(filepath=out)
print("SAVED", out)
