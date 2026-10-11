from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
from pathlib import Path
B=Path('/Users/brayden/Downloads/KnightHacks2026/pitch/.build/3d')
P='http://schemas.openxmlformats.org/presentationml/2006/main';A='http://schemas.openxmlformats.org/drawingml/2006/main';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';P14='http://schemas.microsoft.com/office/powerpoint/2010/main';PKG='http://schemas.openxmlformats.org/package/2006/relationships';CT='http://schemas.openxmlformats.org/package/2006/content-types'
NS={'p':P,'a':A,'r':R,'p14':P14}
def sub(parent,ns,tag,**attrs):return E.SubElement(parent,'{%s}%s'%(ns,tag),{k:str(v) for k,v in attrs.items()})
with ZipFile(B/'base.pptx') as z:data={n:z.read(n) for n in z.namelist()}
for i,name,poster,duration in [(2,'phone-entrance','base1.png',2583),(3,'model-zoom','phone-entrance-end.png',1933)]:
 raw=E.fromstring(data[f'ppt/slides/slide{i}.xml']);root=E.Element(raw.tag,nsmap={**raw.nsmap,**NS});root.attrib.update(raw.attrib)
 for ch in raw:root.append(ch)
 tree=root.find('p:cSld/p:spTree',NS)
 pic=E.Element('{%s}pic'%P);nv=sub(pic,P,'nvPicPr');prop=sub(nv,P,'cNvPr',id=50,name='3D phone entrance' if i==2 else 'Zoom into workout model')
 link=sub(prop,A,'hlinkClick',action='ppaction://media')
 c=sub(nv,P,'cNvPicPr');sub(c,A,'picLocks',noChangeAspect='1')
 nvpr=sub(nv,P,'nvPr');vf=sub(nvpr,A,'videoFile');vf.set('{%s}link'%R,'rId3DVideo')
 el=sub(nvpr,P,'extLst');ex=sub(el,P,'ext',uri='{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}');med=sub(ex,P14,'media');med.set('{%s}embed'%R,'rId3DMedia')
 fill=sub(pic,P,'blipFill');blip=sub(fill,A,'blip');blip.set('{%s}embed'%R,'rId3DPoster');stretch=sub(fill,A,'stretch');sub(stretch,A,'fillRect')
 sp=sub(pic,P,'spPr');xf=sub(sp,A,'xfrm');sub(xf,A,'off',x=0,y=0);sub(xf,A,'ext',cx=12192000,cy=6858000);geo=sub(sp,A,'prstGeom',prst='rect');sub(geo,A,'avLst');tree.append(pic)
 # Play immediately on entering this slide, and hold the final frame until the next click.
 timing=E.Element('{%s}timing'%P);tl=sub(timing,P,'tnLst');par=sub(tl,P,'par');tn=sub(par,P,'cTn',id=1,dur='indefinite',restart='never',nodeType='tmRoot');children=sub(tn,P,'childTnLst')
 seq=sub(children,P,'seq',concurrent=1,nextAc='seek');main=sub(seq,P,'cTn',id=2,dur='indefinite',nodeType='mainSeq');ml=sub(main,P,'childTnLst');pa=sub(ml,P,'par');start=sub(pa,P,'cTn',id=3,fill='hold');sl=sub(start,P,'stCondLst');sub(sl,P,'cond',delay='indefinite');co=sub(sl,P,'cond',evt='onBegin',delay=0);sub(co,P,'tn',val=2);cl=sub(start,P,'childTnLst');pa2=sub(cl,P,'par');eff=sub(pa2,P,'cTn',id=4,presetID=1,presetClass='mediacall',presetSubtype=0,fill='hold',nodeType='afterEffect');ec=sub(eff,P,'stCondLst');sub(ec,P,'cond',delay=0);el=sub(eff,P,'childTnLst');cmd=sub(el,P,'cmd',type='call',cmd='playFrom(0.0)');bh=sub(cmd,P,'cBhvr');sub(bh,P,'cTn',id=5,dur=duration,fill='hold');ta=sub(bh,P,'tgtEl');sub(ta,P,'spTgt',spid=50)
 for tag,event in [('prevCondLst','onPrev'),('nextCondLst','onNext')]:
  li=sub(seq,P,tag);co=sub(li,P,'cond',evt=event,delay=0);ta=sub(co,P,'tgtEl');sub(ta,P,'sldTgt')
 v=sub(children,P,'video');mn=sub(v,P,'cMediaNode',vol=0,numSld=1,showWhenStopped=1);ctn=sub(mn,P,'cTn',id=6,fill='hold',display=0);conditions=sub(ctn,P,'stCondLst');sub(conditions,P,'cond',delay='indefinite');target=sub(mn,P,'tgtEl');sub(target,P,'spTgt',spid=50)
 root.append(timing)
 data[f'ppt/slides/slide{i}.xml']=E.tostring(root,encoding='UTF-8',xml_declaration=True,standalone=True)
 relkey=f'ppt/slides/_rels/slide{i}.xml.rels';rels=E.fromstring(data[relkey])
 sub(rels,PKG,'Relationship',Id='rId3DVideo',Type=R+'/video',Target='../media/'+name+'.mp4')
 sub(rels,PKG,'Relationship',Id='rId3DMedia',Type='http://schemas.microsoft.com/office/2007/relationships/media',Target='../media/'+name+'.mp4')
 sub(rels,PKG,'Relationship',Id='rId3DPoster',Type=R+'/image',Target='../media/'+name+'-poster.png')
 data[relkey]=E.tostring(rels,encoding='UTF-8',xml_declaration=True)
 data['ppt/media/'+name+'.mp4']=(B/(name+'.mp4')).read_bytes();data['ppt/media/'+name+'-poster.png']=(B/poster).read_bytes()
cts=E.fromstring(data['[Content_Types].xml']);sub(cts,CT,'Default',Extension='mp4',ContentType='video/mp4');data['[Content_Types].xml']=E.tostring(cts,encoding='UTF-8',xml_declaration=True)
with ZipFile(B/'candidate.pptx','w',ZIP_DEFLATED) as z:
 for n,b in data.items():z.writestr(n,b)
print('Embedded two auto-playing 3D-rendered animation clips')
