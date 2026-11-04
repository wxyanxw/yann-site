import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ArmPhysics } from '../assets/js/physics.js';
import { createPreset, dhJoint, resizeDefinition, validateDefinition, modelFingerprint } from '../assets/js/models.js';
import { identity, poseTransform, forwardChain } from '../assets/js/kinematics.js';

const load=name=>JSON.parse(readFileSync(new URL(name,import.meta.url)));
const nero=load('../assets/models/nero/definition.json');
const reference=load('./fixtures/nero-fk.json');
const near=(a,b,tolerance=1e-12)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('标准 DH 的 a、alpha、d 和 theta_offset 均参与变换，顺序正确',()=>{
  const model={base:{xyz:[0,0,0],rpy:[0,0,0]},joints:[dhJoint(0,{a:.3,d:.2,offset:Math.PI/2,alpha:Math.PI/2})],tool:[]};
  const fk=forwardChain(model,[0]);
  fk.tip.forEach((v,i)=>near(v,[0,.3,.2][i]));
  const expected=[0,0,1,0,1,0,0,.3,0,1,0,.2,0,0,0,1];
  fk.tipFrame.forEach((v,i)=>near(v,expected[i]));
});

test('增删轴保留前缀关节原值，新关节没有隐含 DH 默认值',()=>{
  const model=createPreset('industrial6'),old=structuredClone(model.joints);
  const resized=resizeDefinition(model,8);
  assert.deepEqual(resized.joints.slice(0,6),old);
  assert.equal(resized.joints[6].a,null);assert.equal(resized.joints[7].alpha,null);
  assert.throws(()=>validateDefinition(resized),/J7.*尚未定义/);
  assert.throws(()=>new ArmPhysics(resized),/J7.*尚未定义/);
  resized.joints[6]=dhJoint(6,{a:.2,alpha:Math.PI/2,d:.1});resized.joints[7]=dhJoint(7);
  const arm=new ArmPhysics(resized);assert.equal(arm.n,8);
  assert.deepEqual(resizeDefinition(resized,6).joints,old);
});

test('DH 参数变化影响 FK，theta_offset 与可控关节 q 分开，重置保留构型',()=>{
  const model=createPreset('single');model.joints[0].offset=.4;
  const arm=new ArmPhysics(model);const tip=arm.getNativeTip();
  const modified=structuredClone(model);modified.joints[0].a=.7;
  const changed=new ArmPhysics(modified);
  near(Math.hypot(...tip),.32);near(Math.hypot(...changed.getNativeTip()),.7);
  near(changed.q[0],0);assert.deepEqual(new ArmPhysics(changed.definition).definition,changed.definition);
  assert.notEqual(modelFingerprint(model),modelFingerprint(modified));
});

test('URDF 原始关节定义、限位与数据来源校验',()=>{
  const raw=readFileSync(new URL('../assets/models/nero/NERO20251209URDF.urdf',import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'),nero.sourceSHA256);
  assert.equal(reference.sourceSHA256,nero.sourceSHA256);
  assert.equal(nero.joints.length,7);
  assert.deepEqual(nero.joints[1].origin.rpy,[1.5708,3.1415,0]);
  assert.equal(nero.joints[3].lower,-1.01);assert.equal(nero.joints[3].upper,2.14);
  assert.equal(nero.joints[6].mass,0);
  assert.ok(nero.joints.every(j=>j.sourceEffort===0&&j.sourceVelocity===0&&j.maxVelocity===2&&j.maxTorque===30));
  const arm=new ArmPhysics(nero);const target=Array.from(arm.q);target[5]=1;
  assert.throws(()=>arm.set(target,'position'),/J6.*0.9500/);
  assert.throws(()=>arm.set(new Array(7).fill(3),'velocity'),/J1.*角速度/);
});

test('NERO 31 组姿态与独立 XML 正运动学一致，包含完整方向矩阵',()=>{
  const arm=new ArmPhysics(nero);
  for(const sample of reference.cases) {
    arm.q.set(sample.q);arm.forward();
    const frame=arm.getNativePose();
    for(let r=0;r<4;r++)for(let c=0;c<4;c++)near(frame[r][c],sample.frame[r][c]);
    arm.getNativeTip().forEach((v,i)=>near(v,sample.frame[i][3]));
  }
});

test('URDF 扩展 DH 从原末端挂接，前七轴的变换完全保留',()=>{
  const extended=resizeDefinition(nero,8);extended.joints[7]=dhJoint(7,{a:.1,d:.04,offset:.3});
  const q=[.2,-.3,.4,.2,-.1,.3,.1,0];
  const original=forwardChain(nero,q.slice(0,7)),after=forwardChain(extended,q);
  assert.deepEqual(after.frames.slice(0,7),original.frames);
  const delta=after.tip.map((v,i)=>v-original.tip[i]);near(Math.hypot(...delta),Math.hypot(.1,.04));
});

test('非零固定工具变换在追加 DH 时保留，校验非法角度和旋转轴',()=>{
  const model=createPreset('single');model.tool=[{xyz:[.2,.1,0],rpy:[0,0,.3]}];
  const extended=resizeDefinition(model,2);const prefix=extended.joints[1].prefix;
  extended.joints[1]=dhJoint(1,{a:0,prefix});
  forwardChain(extended,[0,0]).tip.forEach((v,i)=>near(v,forwardChain(model,[0]).tip[i]));
  const invalid=structuredClone(nero);invalid.joints[0].axis=[0,0,0];assert.throws(()=>validateDefinition(invalid),/旋转轴/);
  const bad=createPreset('single');bad.joints[0].lower=1;assert.throws(()=>validateDefinition(bad),/初始角度/);
});
