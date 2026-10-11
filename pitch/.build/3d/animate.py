import bpy,math
from mathutils import Vector
B='/Users/brayden/Downloads/KnightHacks2026/pitch/.build/3d'
bpy.ops.wm.open_mainfile(filepath=B+'/phone-scene.blend')
s=bpy.context.scene;r=bpy.data.objects['iPhone 15 Pro animation rig']
s.render.resolution_percentage=100;s.eevee.taa_render_samples=16
s.use_nodes=True;nt=s.node_tree;nt.nodes.clear()
rl=nt.nodes.new('CompositorNodeRLayers');bg=nt.nodes.new('CompositorNodeImage');bg.image=bpy.data.images.load(B+'/base1.png')
a=nt.nodes.new('CompositorNodeAlphaOver');a.inputs[0].default_value=1
nt.links.new(bg.outputs['Image'],a.inputs[1]);nt.links.new(rl.outputs['Image'],a.inputs[2]);out=nt.nodes.new('CompositorNodeComposite');nt.links.new(a.outputs['Image'],out.inputs['Image'])
def key(f,pos,deg,scale=1):
 r.location=pos;r.rotation_euler=tuple(math.radians(x) for x in deg);r.scale=(scale,)*3
 r.keyframe_insert(data_path='location',frame=f);r.keyframe_insert(data_path='rotation_euler',frame=f);r.keyframe_insert(data_path='scale',frame=f)
def clamp():
 for fc in r.animation_data.action.fcurves:
  for k in fc.keyframe_points:k.interpolation='BEZIER';k.handle_left_type='AUTO_CLAMPED';k.handle_right_type='AUTO_CLAMPED'
def video(name,end):
 s.frame_start=1;s.frame_end=end;s.render.image_settings.file_format='FFMPEG';s.render.ffmpeg.format='MPEG4';s.render.ffmpeg.codec='H264';s.render.ffmpeg.constant_rate_factor='HIGH';s.render.ffmpeg.ffmpeg_preset='GOOD';s.render.ffmpeg.audio_codec='NONE';s.render.filepath=B+'/'+name+'.mp4'
 bpy.ops.wm.save_as_mainfile(filepath=B+'/'+name+'.blend');bpy.ops.render.render(animation=True)
 s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGBA';bpy.data.images['Render Result'].save_render(B+'/'+name+'-end.png',scene=s)
# One choreographed turn, with pitch and roll changing as the phone passes through back and edge views.
key(1,(12,0,1.3),(55,-35,-350))
key(36,(7.6,0,.65),(-24,28,-235))
key(72,(5.7,0,.18),(18,-14,-120))
key(125,(4.1,0,0),(-3,-5,-14))
key(155,(4.1,0,0),(-10,-4,-12))
key(180,(4.1,0,0),(-10,-4,-12))
clamp();video('phone-entrance',155)
# Straighten into the display, then push through the hardware to the supplied model area.
r.animation_data_clear()
key(1,(4.1,0,0),(-10,-4,-12))
key(38,(3.05,0,-.05),(0,0,0),1.25)
# Screen span in the supplied source model, retained exactly from the measured source mesh.
w=(.03563930094242096+.03563930466771126)*39
h=(.07701563835144043+.07701393216848373)*39
k=14.2222/w
row=(805+663/2)/2556
zc=(.07701563835144043-row*(.07701563835144043+.07701393216848373))*39
key(116,(0,0,-zc*k),(0,0,0),k)
key(150,(0,0,-zc*k),(0,0,0),k)
clamp();video('model-zoom',116)
print('Rendered both 1080p / 60fps animations')
