import fs from 'node:fs/promises';
import {Presentation,PresentationFile} from '@oai/artifact-tool';
const b='/Users/brayden/Downloads/KnightHacks2026/pitch/.build';
const p=Presentation.create({slideSize:{width:1280,height:720}});
for(let i=0;i<3;i++){
 const s=p.slides.add();s.background.fill='#09131C';
 if(i<2){
  function txt(name,t,x,y,w,h,size,col,bold){const q=s.shapes.add({name,geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});q.text=t;q.text.style={typeface:'Avenir Next',fontSize:size,color:col,bold};q.text.insets=0;}
  txt('Product name','SteadyForum',92,258,720,118,86,'#F7FBFF',true);
  txt('Pitch description','The future of working out\nwithout getting hurt',99,398,680,100,29,'#B7CAD8',false);
 } else {
  s.images.add({blob:new Uint8Array(await fs.readFile(b+'/train.png')),contentType:'image/png',alt:'The workout model from the supplied screenshot',fit:'cover',position:{left:0,top:0,width:1280,height:720},crop:{left:0,top:805/2556,right:0,bottom:(2556-1468)/2556}});
 }
 s.speakerNotes.text='iPhone 15 Pro model by Sketcher (@jnanbr07), CC BY 4.0. Source: https://sketchfab.com/3d-models/iphone-15-pro-9e045e469d514fea9dda2ccd161f5fa3. Licensed mesh sourced through https://github.com/quentin-pla/phone-mockup-studio. Modified by replacing the display texture with IMG_6540.PNG and adding lighting and animation. Product screenshot supplied by presenter.';
 if(i===0)s.images.add({blob:new Uint8Array(await fs.readFile(b+'/3d/base1.png')),contentType:'image/png',alt:'Rendered title for consistent typography during the transition; editable title text underneath',fit:'contain',position:{left:0,top:0,width:1280,height:720}});
 const png=await p.export({slide:s,format:'png',scale:1.5});await fs.writeFile(b+'/3d/base'+(i+1)+'.png',new Uint8Array(await png.arrayBuffer()));
}
await(await PresentationFile.exportPptx(p)).save(b+'/3d/base.pptx');
console.log('Built editable premium title slides and model crop');
