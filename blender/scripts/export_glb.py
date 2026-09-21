# Esporta il GLB per il frontend:
#   Blender -b man-model.blend --python export_glb.py -- ../frontend/public/assets/man-model.glb
import bpy, sys
out = sys.argv[sys.argv.index("--")+1]
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True,
    export_apply=False, export_morph=True, export_morph_normal=True, export_skins=True,
    export_normals=True, export_texcoords=True, export_image_format='AUTO', export_materials='EXPORT',
    export_animations=False, use_selection=False)
print("EXPORTED", out)
