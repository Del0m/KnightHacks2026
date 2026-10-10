import * as THREE from 'three';
export function createMovement(model, dumbbellModel) {
 const bones={},rest=new Map(),weights=[];
 model.traverse(b=>{if(b.isBone)b.quaternion.normalize();});model.updateMatrixWorld(true);
 model.traverse(b=>{if(b.isBone){bones[b.userData.name||b.name.replace(/([LR])$/,'.$1')]=b;rest.set(b,{q:b.quaternion.clone(),p:b.position.clone(),world:b.getWorldQuaternion(new THREE.Quaternion()),position:b.getWorldPosition(new THREE.Vector3()),direction:new THREE.Vector3(0,1,0).applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion()))});}});
 const names=['upperarm01.L','upperarm01.R','lowerarm01.L','lowerarm01.R','lowerarm02.L','lowerarm02.R','upperleg01.L','upperleg01.R','lowerleg01.L','lowerleg01.R','foot.L','foot.R','wrist.L','wrist.R','spine05','root'];
 const pos=name=>bones[name].getWorldPosition(new THREE.Vector3());
 const original=name=>rest.get(bones[name]).position;
 for(const side of ['L','R'])for(const [start,end] of [['upperarm01','lowerarm01'],['lowerarm01','wrist'],['upperleg01','lowerleg01'],['lowerleg01','foot']]){
  const r=rest.get(bones[start+'.'+side]);r.direction=original(end+'.'+side).clone().sub(r.position).normalize();
 }
 const handFrames={};
 for(const side of ['L','R']){
  const wrist=bones['wrist.'+side],r=rest.get(wrist),sign=side==='L'?1:-1;
  const knuckles=original('finger3-1.'+side),forward=knuckles.clone().sub(r.position).normalize();
  const lateral=original('finger2-1.'+side).clone().sub(original('finger5-1.'+side)).normalize();
  const normal=new THREE.Vector3().crossVectors(forward,lateral).multiplyScalar(sign).normalize();
  r.direction=forward;
  handFrames[side]={normal,foot:original('foot.'+side).clone(),thigh:original('upperleg01.'+side).distanceTo(original('lowerleg01.'+side)),shin:original('lowerleg01.'+side).distanceTo(original('foot.'+side))};
  for(let finger=1;finger<=5;finger++)for(let joint=1;joint<=3;joint++){
   const name=`finger${finger}-${joint}.${side}`,bone=bones[name];if(!bone)continue;
   const b=rest.get(bone);b.curlAxis=new THREE.Vector3().crossVectors(b.direction,normal).normalize().applyQuaternion(b.world.clone().invert());names.push(name);
  }
  if(dumbbellModel){
   const grip=knuckles.clone().addScaledVector(forward,-.017).addScaledVector(normal,.016);
   const holder=new THREE.Group();holder.name='DumbbellGrip.'+side;holder.position.copy(wrist.worldToLocal(grip.clone()));
   holder.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),lateral.clone().applyQuaternion(r.world.clone().invert()));
   const asset=dumbbellModel.clone(true),bounds=new THREE.Box3().setFromObject(asset),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
   asset.position.sub(center);const normalized=new THREE.Group();normalized.add(asset);normalized.scale.setScalar(.28/size.x);holder.add(normalized);wrist.add(holder);weights.push(holder);holder.visible=false;
  }
 }
 let selected=null,playing=false,phase=0;
 const desired=new THREE.Quaternion(),parent=new THREE.Quaternion();
 function orient(name,direction,blend,palmNormal,twistAmount=1){
  const bone=bones[name],r=rest.get(bone),dir=new THREE.Vector3(...direction).normalize();
  const swing=new THREE.Quaternion().setFromUnitVectors(r.direction,dir);
  if(palmNormal){
   const side=name.endsWith('.L')?'L':'R',current=handFrames[side].normal.clone().applyQuaternion(swing);
   current.addScaledVector(dir,-current.dot(dir)).normalize();
   const normal=new THREE.Vector3(...palmNormal).addScaledVector(dir,-new THREE.Vector3(...palmNormal).dot(dir)).normalize();
   const twist=Math.atan2(new THREE.Vector3().crossVectors(current,normal).dot(dir),current.dot(normal));
   swing.premultiply(new THREE.Quaternion().setFromAxisAngle(dir,twist*twistAmount));
  }
  desired.copy(swing).multiply(r.world);bone.parent.getWorldQuaternion(parent);desired.premultiply(parent.invert());bone.quaternion.slerp(desired,blend);bone.updateWorldMatrix(false,true);
 }
 function grip(side,blend){
  for(let finger=2;finger<=5;finger++)for(let joint=1;joint<=3;joint++){
   const bone=bones[`finger${finger}-${joint}.${side}`];if(!bone)continue;
   const r=rest.get(bone),angle=[1.0,1.45,.8][joint-1];
   desired.copy(r.q).multiply(new THREE.Quaternion().setFromAxisAngle(r.curlAxis,angle));bone.quaternion.slerp(desired,blend);
  }
  bones['wrist.'+side].updateWorldMatrix(false,true);
  // Oppose the thumb across the closed index finger, rather than flexing it like a finger.
  const target=pos('finger2-1.'+side);
  orient('finger1-1.'+side,target.clone().sub(pos('finger1-1.'+side)).toArray(),blend);
  const tip=pos('finger3-2.'+side);
  const direction=tip.clone().sub(pos('finger1-2.'+side)).normalize();
  orient('finger1-2.'+side,direction.toArray(),blend);
  orient('finger1-3.'+side,pos('finger3-3.'+side).sub(pos('finger1-3.'+side)).toArray(),blend);
 }
 function kneeTarget(hip,ankle,thigh,shin,bendDirection){
  const toward=ankle.clone().sub(hip),distance=THREE.MathUtils.clamp(toward.length(),Math.abs(thigh-shin)+.00001,thigh+shin-.00001);toward.normalize();
  const along=(thigh*thigh-shin*shin+distance*distance)/(2*distance);
  const bend=bendDirection.clone().addScaledVector(toward,-bendDirection.dot(toward)).normalize();
  return hip.clone().addScaledVector(toward,along).addScaledVector(bend,Math.sqrt(Math.max(0,thigh*thigh-along*along)));
 }
 function leg(side,blend,ankle=handFrames[side].foot,prone=false){
  const f=handFrames[side],hip=pos('upperleg01.'+side);
  const knee=kneeTarget(hip,ankle,f.thigh,f.shin,new THREE.Vector3(0,prone?-1:0,prone?0:1));
  orient('upperleg01.'+side,knee.clone().sub(hip).toArray(),blend);
  orient('lowerleg01.'+side,ankle.clone().sub(pos('lowerleg01.'+side)).toArray(),blend);
  // Preserve the original ankle orientation, keeping the soles level.
  const bone=bones['foot.'+side],r=rest.get(bone);bone.parent.getWorldQuaternion(parent);desired.copy(r.world);if(prone)desired.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.7));desired.premultiply(parent.invert());bone.quaternion.slerp(desired,blend);bone.updateWorldMatrix(false,true);
 }
 return {
  bones,weights,
  select(id){selected=['curl','squat','press','push_up','lunge'].includes(id)?id:null;phase=0;playing=Boolean(selected);for(const [bone,r] of rest){bone.quaternion.copy(r.q);bone.position.copy(r.p);}model.updateMatrixWorld(true);weights.forEach(w=>w.visible=selected==='curl'||selected==='press'||selected==='lunge');},
  pause(){playing=!playing;return playing;},get playing(){return playing;},
  update(dt,reduced){
   if(playing&&!reduced)phase+=Math.min(dt,.05);
   const rep=(1-Math.cos(phase*Math.PI/2))/2,blend=1-Math.exp(-dt*18);
   if(!selected){for(const name of names){const b=bones[name],r=rest.get(b);b.quaternion.slerp(r.q,blend);b.position.lerp(r.p,blend);}model.updateMatrixWorld(true);return;}
   const squat=selected==='squat',press=selected==='press',pushUp=selected==='push_up',lunge=selected==='lunge',root=bones.root,r=rest.get(root);
   const proneHeight=.42-.18*rep,footOffset=handFrames.L.foot.clone().sub(r.position);
   // Pivot the straight body about the toes while the elbows flex.
   const proneAngle=Math.acos((proneHeight-handFrames.L.foot.y)/Math.hypot(footOffset.y,footOffset.z))+Math.atan2(footOffset.z,-footOffset.y);
   root.parent.getWorldQuaternion(parent);desired.copy(r.world);if(pushUp)desired.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),proneAngle));desired.premultiply(parent.clone().invert());root.quaternion.slerp(desired,blend);
   const worldDelta=new THREE.Vector3(0,pushUp?proneHeight-r.position.y:squat?-.48*rep:lunge?-.13-.35*rep:0,squat?-.22*rep:0);worldDelta.applyQuaternion(parent.invert());root.position.lerp(r.p.clone().add(worldDelta),blend);model.updateMatrixWorld(true);
   if(pushUp){bones.spine05.quaternion.slerp(rest.get(bones.spine05).q,blend);bones.spine05.updateWorldMatrix(false,true);}else orient('spine05',squat?[0,1,rep*.55]:[0,1,0],blend);
   for(const side of ['L','R']){
    const sign=side==='L'?1:-1;let forearm,palm;
    if(pushUp){
     // Hands stay planted beside the chest; elbow flexion lowers a straight torso.
     const shoulder=pos('upperarm01.'+side),hand=new THREE.Vector3(sign*.31,.045,.48);
     const upper=original('upperarm01.'+side).distanceTo(original('lowerarm01.'+side)),lower=original('lowerarm01.'+side).distanceTo(original('wrist.'+side));
     const elbow=kneeTarget(shoulder,hand,upper,lower,new THREE.Vector3(sign,0,-.65));
     orient('upperarm01.'+side,elbow.sub(shoulder).toArray(),blend);forearm=hand.sub(pos('lowerarm01.'+side)).toArray();palm=[0,-1,0];
    }else if(press){
     const a=rep*1.48;orient('upperarm01.'+side,[sign*Math.cos(a),Math.sin(a),.04],blend);forearm=[sign*.09,1,0];palm=[0,0,1];
    }else if(squat){
     orient('upperarm01.'+side,[sign*.08,-.05,1],blend);forearm=[0,.02,1];palm=[0,-1,0];
    }else if(lunge){
     // Neutral grip: palms face the thighs; straight arms clear the hips.
     palm=[-sign,0,0];orient('upperarm01.'+side,[sign*.12,-1,-.03],blend,palm,.35);forearm=[sign*.04,-1,.02];
    }else{
     const a=rep*2.35;orient('upperarm01.'+side,[sign*.04,-1,0],blend);forearm=[0,-Math.cos(a),Math.sin(a)];palm=[0,Math.sin(a),Math.cos(a)];
    }
    orient('lowerarm01.'+side,forearm,blend,palm,.5);orient('lowerarm02.'+side,forearm,blend,palm);orient('wrist.'+side,pushUp?[0,0,1]:forearm,blend,palm);
    if(squat||pushUp){for(let finger=1;finger<=5;finger++)for(let joint=1;joint<=3;joint++){const b=bones[`finger${finger}-${joint}.${side}`];if(b)b.quaternion.slerp(rest.get(b).q,blend);}}
    else grip(side,blend);
    const ankle=handFrames[side].foot.clone();if(lunge)ankle.z+=side==='L'?.43:-.43;if(pushUp)ankle.sub(r.position).applyAxisAngle(new THREE.Vector3(1,0,0),proneAngle).add(new THREE.Vector3(r.position.x,proneHeight,r.position.z));
    leg(side,blend,ankle,pushUp);
   }
   model.updateMatrixWorld(true);
  }
 };
}
