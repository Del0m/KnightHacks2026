import bpy, math, os, json
from mathutils import Vector, Matrix
B='/Users/brayden/Downloads/KnightHacks2026/pitch/.build/3d'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=B+'/iphone.glb')
meshes=[o for o in bpy.data.objects if o.type=='MESH']
for o in meshes:
 world=o.matrix_world.copy()
 o.parent=None;o.matrix_world=Matrix.Identity(4);o.data.transform(world)
# Existing asset is authored in meters. Front faces +Y, up is +Z.
# Replace only the display texture, preserving every hardware mesh.
screen=next(o for o in meshes if any(m and m.name=='pIJKfZsazmcpEiU' for m in o.data.materials))
verts=[v.co for v in screen.data.vertices];xmin=min(v.x for v in verts);xmax=max(v.x for v in verts);zmin=min(v.z for v in verts);zmax=max(v.z for v in verts)
uv=screen.data.uv_layers.active or screen.data.uv_layers.new()
for poly in screen.data.polygons:
 for li in poly.loop_indices:
  v=screen.data.vertices[screen.data.loops[li].vertex_index].co
  uv.data[li].uv=(1-(v.x-xmin)/(xmax-xmin),(v.z-zmin)/(zmax-zmin))
m=bpy.data.materials.new('SteadyForum Screenshot Display');m.use_nodes=True;n=m.node_tree.nodes;n.clear()
tex=n.new('ShaderNodeTexImage');tex.image=bpy.data.images.load('/Users/brayden/Downloads/IMG_6540.PNG');tex.interpolation='Linear'
em=n.new('ShaderNodeEmission');out=n.new('ShaderNodeOutputMaterial');m.node_tree.links.new(tex.outputs['Color'],em.inputs['Color']);m.node_tree.links.new(em.outputs[0],out.inputs['Surface']);screen.data.materials.clear();screen.data.materials.append(m)
# A sober titanium finish and controlled dark cover glass.
for mat in bpy.data.materials:
 if mat==m or not mat.use_nodes:continue
 for node in mat.node_tree.nodes:
  if node.type=='BSDF_PRINCIPLED':
   if node.inputs.get('Roughness'):node.inputs['Roughness'].default_value=max(node.inputs['Roughness'].default_value,0.20)
   if node.inputs.get('Coat Weight'):node.inputs['Coat Weight'].default_value=0.15
# Parent into a centered animation rig. Keep original source mesh unchanged on disk.
rig=bpy.data.objects.new('iPhone 15 Pro animation rig',None);bpy.context.collection.objects.link(rig)
orient=bpy.data.objects.new('Source model orientation',None);bpy.context.collection.objects.link(orient);orient.parent=rig
orient.rotation_euler[2]=math.pi;orient.scale=(39.0,)*3
for o in meshes:o.parent=orient
# Camera: ortho offers controlled product framing, actual 3D foreshortening remains.
bpy.ops.object.camera_add(location=(0,-14,0));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=14.2222;bpy.context.scene.camera=cam
# Large studio softboxes create actual surface reflections as the mesh rotates.
def light(name,pos,power,size,color):
 data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='RECTANGLE';data.size=size;data.size_y=size*2.2;data.color=color
 o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector((4,0,0))-o.location).to_track_quat('-Z','Y').to_euler()
light('Key softbox',(-4,-5,6),1100,5,(0.82,0.91,1.0))
light('Right rim softbox',(7,2,4),1500,3,(0.55,0.76,1.0))
light('Left reflected strip',(1,-2,-4),700,2,(1.0,0.9,0.8))
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT';scene.eevee.taa_render_samples=64
scene.render.resolution_x=1920;scene.render.resolution_y=1080;scene.render.resolution_percentage=100;scene.render.fps=60
scene.render.film_transparent=True;scene.world=bpy.data.worlds.new('Studio ambient');scene.world.color=(.14,.14,.14)
scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
# Keep PNG RGBA for a keyframe inspection before rendering the movies.
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
scene.render.filepath=B+'/hero.png';rig.location=(4.1,0,0);rig.rotation_euler=tuple(math.radians(x) for x in (6,-5,-16))
bpy.ops.wm.save_as_mainfile(filepath=B+'/phone-scene.blend')
scene.render.resolution_percentage=60;bpy.ops.render.render(write_still=True)
print('SCREEN_BOUNDS',xmin,xmax,zmin,zmax)
