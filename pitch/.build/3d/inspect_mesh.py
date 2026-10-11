import bpy
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath='/Users/brayden/Downloads/KnightHacks2026/pitch/.build/3d/iphone.glb')
for o in bpy.data.objects:
 if o.type=='MESH':
  pts=[o.matrix_world@Vector(c) for c in o.bound_box]
  print(o.name, 'verts',len(o.data.vertices),'dimensions',list(o.dimensions),'bounds',[[min(p[i] for p in pts),max(p[i] for p in pts)] for i in range(3)],'materials',[(m.name if m else None) for m in o.data.materials])
