import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GLTFLoader} from './GLTFLoader.js';
import {createMovement} from './movement.js';
import * as THREE from './three.module.js';
const data=await readFile(new URL('./rigged-human.glb',import.meta.url));
const {scene}=await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
const motion=createMovement(scene),initial=motion.bones['lowerarm01.L'].quaternion.clone();
let mesh;scene.traverse(o=>{if(o.isSkinnedMesh)mesh=o;});assert(mesh);assert.equal(mesh.skeleton.bones.length,163);
const v=new THREE.Vector3();
for(const exercise of ['curl','squat','press']){
 motion.select(exercise);const start=motion.bones['wrist.L'].getWorldPosition(new THREE.Vector3());let distance=0;
 for(let frame=0;frame<480;frame++){
  motion.update(1/60,false);distance=Math.max(distance,start.distanceTo(motion.bones['wrist.L'].getWorldPosition(new THREE.Vector3())));
  for(const bone of Object.values(motion.bones))assert(bone.matrixWorld.elements.every(Number.isFinite));
  mesh.skeleton.update();for(const index of [0,100,1000,10000]){mesh.getVertexPosition(index,v);assert(v.toArray().every(Number.isFinite));}
 }
 assert(distance>.05,`${exercise} did not move`);
 motion.pause();const paused=motion.bones['wrist.L'].getWorldPosition(new THREE.Vector3());for(let i=0;i<180;i++)motion.update(1/60,false);
 const settled=motion.bones['wrist.L'].getWorldPosition(new THREE.Vector3());for(let i=0;i<60;i++)motion.update(1/60,false);
 assert(settled.distanceTo(motion.bones['wrist.L'].getWorldPosition(new THREE.Vector3()))<.00001,'Pause drift');
 console.log(exercise,'moves, pauses, and keeps skin coordinates finite');
}
motion.select(null);for(let i=0;i<180;i++)motion.update(1/60,false);assert(initial.angleTo(motion.bones['lowerarm01.L'].quaternion)<.0001);
console.log('163-joint rig: all checks passed');
