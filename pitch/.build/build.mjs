import fs from 'node:fs/promises';
import {Presentation,PresentationFile} from '@oai/artifact-tool';
const root='/Users/brayden/Downloads/KnightHacks2026/pitch/.build';
const p=Presentation.create({slideSize:{width:1280,height:720}});
const screen=new Uint8Array(await fs.readFile(root+'/train.png'));
function text(s,name,content,x,y,w,h,size,color,bold=false){
 const sh=s.shapes.add({name,geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 sh.text=content;sh.text.style={typeface:'Arial',fontSize:size,color,bold};sh.text.insets=0;return sh;
}
function rect(s,name,x,y,w,h,fill,r){return s.shapes.add({name,geometry:r?'roundRect':'rect',position:{left:x,top:y,width:w,height:h},fill,line:{fill:'none',width:0},...(r?{borderRadius:r}:{})});}
for(let i=0;i<3;i++){
 const s=p.slides.add();s.background.fill='#F5FAFE';
 // Consistent native, editable pitch typography.
 if(i===0){rect(s,'!!accent',92,228,72,6,'#397BAA');text(s,'!!title','SteadyForum',88,266,1040,120,100,'#213D4D',true);text(s,'!!tagline','The future of working out without getting hurt',94,411,1020,68,31,'#4F6878');}
 if(i===1){rect(s,'!!accent',92,224,72,6,'#397BAA');text(s,'!!title','SteadyForum',88,264,700,100,72,'#213D4D',true);text(s,'!!tagline','The future of working out\nwithout getting hurt',94,379,640,120,31,'#4F6878');}
 if(i===2){rect(s,'!!accent',-900,224,72,6,'#397BAA');text(s,'!!title','SteadyForum',-1200,264,700,100,72,'#213D4D',true);text(s,'!!tagline','The future of working out\nwithout getting hurt',-1200,379,640,120,31,'#4F6878');}
 // Phone objects use a common 300 x 650 local coordinate system.
 rect(s,'phone-rim',0,0,300,650,'#596571',47);
 rect(s,'phone-body',3,3,294,644,'#101820',44);
 const im=s.images.add({blob:screen,contentType:'image/png',alt:'Actual SteadyForum Train screen',fit:'contain',position:{left:12,top:26,width:276,height:598.32},geometry:'roundRect',borderRadius:30});
 rect(s,'phone-island',114,10,72,16,'#060A0E',8);
 rect(s,'phone-home',110,634,80,4,'#CFD8DE',2);
 rect(s,'phone-button',-2,116,3,35,'#596571',1);
 rect(s,'phone-volume',-2,160,3,58,'#596571',1);
 rect(s,'phone-power',299,171,3,65,'#596571',1);
 s.speakerNotes.text='Product screen supplied by the presenter: IMG_6540.PNG. Morph object matching and rotation follow Microsoft PowerPoint Morph guidance: https://support.microsoft.com/en-us/powerpoint/morph-transition-tips-and-tricks';
}
await (await PresentationFile.exportPptx(p)).save(root+'/raw.pptx');
console.log('Created 3-slide draft');
