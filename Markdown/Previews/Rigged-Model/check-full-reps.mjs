import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import{GLTFLoader}from'./GLTFLoader.js';import{createMovement}from'./movement.js';import * as T from './three.module.js';
async function load(name){const a=await readFile(new URL(name,import.meta.url));const loader=new GLTFLoader();loader.register(()=>({name:'HEADLESS_MATERIAL',loadMaterial(){return Promise.resolve(new T.MeshStandardMaterial());}}));return(await loader.parseAsync(a.buffer.slice(a.byteOffset,a.byteOffset+a.byteLength),'')).scene;}
const body=await load('rigged-human.glb'),bell=await load('dumbbell.glb'),motion=createMovement(body,bell);
const p=name=>motion.bones[name].getWorldPosition(new T.Vector3()),feet={L:p('foot.L'),R:p('foot.R')};
for(const id of ['curl','squat','press']){
 motion.select(id);for(let i=0;i<120;i++)motion.update(1/60,false);motion.pause();for(let i=0;i<120;i++)motion.update(1/60,false);
 for(const side of ['L','R']){
  assert(p('foot.'+side).distanceTo(feet[side])<.002,'Foot moved');
  const hip=p('upperleg01.'+side),knee=p('lowerleg01.'+side);
  if(id==='squat'){console.log('Squat hip minus knee height:',(hip.y-knee.y).toFixed(4));assert(Math.abs(hip.y-knee.y)<.035,'Squat must stop near parallel');assert(!motion.weights[0].visible);}
  if(id==='press'){const shoulder=p('upperarm01.'+side),elbow=p('lowerarm01.'+side),wrist=p('wrist.'+side);const a=elbow.clone().sub(shoulder).normalize(),b=wrist.clone().sub(elbow).normalize();assert(a.angleTo(b)<.15,'Press must extend elbows');}
  if(id==='curl'){const shoulder=p('upperarm01.'+side),elbow=p('lowerarm01.'+side),wrist=p('wrist.'+side);assert(elbow.clone().sub(shoulder).angleTo(wrist.clone().sub(elbow))>2.2,'Curl needs full flexion');}
 }
 for(const w of motion.weights){const original=w.position.clone();motion.pause();for(let i=0;i<120;i++)motion.update(1/60,false);assert(original.distanceTo(w.position)<1e-8,'Dumbbell attachment slipped');motion.pause();}
 console.log(id,'range and attachment checks passed');
}
