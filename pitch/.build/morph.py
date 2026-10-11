from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
from pathlib import Path
P='http://schemas.openxmlformats.org/presentationml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
MC='http://schemas.openxmlformats.org/markup-compatibility/2006'
P14='http://schemas.microsoft.com/office/powerpoint/2010/main'
P159='http://schemas.microsoft.com/office/powerpoint/2015/09/main'
NS={'p':P,'a':A,'mc':MC,'p14':P14,'p159':P159}
def sub(parent,ns,tag,**attrs):return E.SubElement(parent,'{%s}%s'%(ns,tag),{k:str(v) for k,v in attrs.items()})
def emu(v):return round(v*9525)
# Slides are keyframes. The last screenshot placement maps source rows 805..1468
# into the 720px slide, keeping the full figure and moving all chrome off-canvas.
k=1280/276
scale_source=1280/1179
frames=[(1480,50,300,650,-26),(842,44,292,650*292/300,0),(-12*k,-26*k-805*scale_source,300*k,650*k,0)]
with ZipFile('pitch/.build/raw.pptx') as z:
 data={n:z.read(n) for n in z.namelist()}
for i,(x,y,w,h,rot) in enumerate(frames,1):
 key=f'ppt/slides/slide{i}.xml';old=E.fromstring(data[key]);root=E.Element(old.tag,nsmap={**old.nsmap,**NS});root.attrib.update(old.attrib)
 for ch in old:root.append(ch)
 tree=root.find('p:cSld/p:spTree',NS)
 # Three typography shapes precede the phone parts.
 members=list(tree)[5:]
 group=E.Element('{%s}grpSp'%P)
 nv=sub(group,P,'nvGrpSpPr');sub(nv,P,'cNvPr',id=99,name='!!iPhone');sub(nv,P,'cNvGrpSpPr');sub(nv,P,'nvPr')
 pr=sub(group,P,'grpSpPr');xf=sub(pr,A,'xfrm',rot=round(rot*60000))
 sub(xf,A,'off',x=emu(x),y=emu(y));sub(xf,A,'ext',cx=emu(w),cy=emu(h));sub(xf,A,'chOff',x=0,y=0);sub(xf,A,'chExt',cx=emu(300),cy=emu(650))
 for item in members:
  tree.remove(item);group.append(item)
  for lock in item.xpath('.//a:spLocks',namespaces=NS):lock.attrib.pop('noGrp',None)
 tree.append(group)
 if i>1:
  ac=E.Element('{%s}AlternateContent'%MC)
  choice=sub(ac,MC,'Choice',Requires='p159')
  tr=sub(choice,P,'transition',spd='slow',advClick='1');tr.set('{%s}dur'%P14,'1600' if i==2 else '1800')
  sub(tr,P159,'morph',option='byObject')
  fall=sub(ac,MC,'Fallback');tr2=sub(fall,P,'transition',spd='slow',advClick='1');sub(tr2,P,'fade')
  root.insert(1,ac)
 data[key]=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile('pitch/.build/candidate.pptx','w',ZIP_DEFLATED) as z:
 for n,b in data.items():z.writestr(n,b)
print('Added matched phone groups and click-controlled Morph transitions')
