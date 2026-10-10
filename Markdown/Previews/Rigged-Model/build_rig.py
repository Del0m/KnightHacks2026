import bpy,json,math
from pathlib import Path
from mathutils import Vector
root=Path(__file__).resolve().parent
source=root/'makehuman-base.obj'
verts=[];faces=[];group=''
for line in source.read_text().splitlines():
 if line.startswith('v '):verts.append(Vector(map(float,line.split()[1:4])))
 elif line.startswith('g '):group=line[2:]
 elif line.startswith('f ') and group in ('body','helper-l-eye','helper-r-eye'):faces.append([int(a.split('/')[0])-1 for a in line.split()[1:]])
for filename in ['mh-male.target','mh-shape.target']:
 for line in (root/filename).read_text().splitlines():
  if not line.strip() or line.startswith('#'):continue
  values=line.split();verts[int(values[0])]+=Vector(map(float,values[1:4]))
used=sorted({i for f in faces for i in f});mapping={v:i for i,v in enumerate(used)}
low=min(verts[i].y for i in used);high=max(verts[i].y for i in used);scale=1.82/(high-low)
# Blender Z-up; glTF export converts back to the viewer's Y-up.
def point(v):return Vector((v.x*scale,-v.z*scale,(v.y-low)*scale))
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
mesh=bpy.data.meshes.new('SmoothHuman');mesh.from_pydata([point(verts[i]) for i in used],[],[[mapping[i] for i in f] for f in faces]);mesh.update()
obj=bpy.data.objects.new('SmoothHuman',mesh);bpy.context.collection.objects.link(obj)
for poly in mesh.polygons:poly.use_smooth=True
spec=json.loads((root/'default.mhskel').read_text());weights=json.loads((root/'default_weights.mhw').read_text())['weights']
arm=bpy.data.armatures.new('HumanSkeleton');rig=bpy.data.objects.new('HumanRig',arm);bpy.context.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name,bone in spec['bones'].items():
 b=arm.edit_bones.new(name)
 for attr in ['head','tail']:
  ids=spec['joints'][bone[attr]];setattr(b,attr,point(sum((verts[i] for i in ids),Vector())/len(ids)))
 if (b.tail-b.head).length<.00001:b.tail.z+=.001
for name,bone in spec['bones'].items():
 if bone['parent']:arm.edit_bones[name].parent=arm.edit_bones[bone['parent']]
bpy.ops.object.mode_set(mode='OBJECT')
for name,entries in weights.items():
 vg=obj.vertex_groups.new(name=name)
 for old,w in entries:
  if old in mapping:vg.add([mapping[old]],w,'REPLACE')
# Matching authored weights are interpolated by subdivision, not guessed from surface proximity.
rig.select_set(False);obj.select_set(True);bpy.context.view_layer.objects.active=obj
smooth=obj.modifiers.new('Subtle smoothing','SMOOTH');smooth.factor=.4;smooth.iterations=4;bpy.ops.object.modifier_apply(modifier=smooth.name)
sub=obj.modifiers.new('Smooth finish','SUBSURF');sub.levels=1;bpy.ops.object.modifier_apply(modifier=sub.name)
# A gentle local taper gives the wrists a sturdier natural silhouette.
for side in ['L','R']:
 wrist=arm.bones['wrist.'+side].head_local.copy()
 axis=(wrist-arm.bones['lowerarm01.'+side].head_local).normalized()
 for v in obj.data.vertices:
  delta=v.co-wrist;along=delta.dot(axis);radial=delta-axis*along
  if abs(along)<.13 and radial.length<.08:
   v.co+=radial*(.32*math.exp(-along*along/.0024))
obj.data.update()
mod=obj.modifiers.new('Human skeleton','ARMATURE');mod.object=rig;obj.parent=rig
assert all(v.groups for v in obj.data.vertices),'Unweighted vertices'
assert 'helper-genital' not in [o.name for o in bpy.data.objects]
bpy.ops.wm.save_as_mainfile(filepath=str(root/'rigged-human.blend'))
bpy.ops.export_scene.gltf(filepath=str(root/'rigged-human.glb'),export_format='GLB',export_yup=True,export_animations=False,export_skins=True,export_all_influences=False)
print('RIG_COMPLETE',len(arm.bones),'bones',len(obj.data.vertices),'vertices')
