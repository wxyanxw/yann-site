import test from 'node:test';
import assert from 'node:assert/strict';
import { ArmPhysics } from '../assets/js/physics.js';
import { validateDefinition, resizeDefinition, modelFingerprint } from '../assets/js/models.js';
import { identity } from '../assets/js/kinematics.js';

const definition=(motion='prismatic')=>({schemaVersion:1,id:'custom',label:'types',source:'URDF',
  base:{xyz:[0,.1,0],rpy:[-Math.PI/2,0,0]},tool:[],joints:[{kind:'urdf',motion,name:'slide',origin:{xyz:[0,0,.2],rpy:[0,0,0]},axis:[0,0,2],com:[0,0,0],prefix:[],
    q0:.1,lower:0,upper:.5,maxVelocity:.2,maxTorque:40,mass:2,configured:true}]});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);

test('直线关节按归一化 axis 平移，使用 m、m/s 和 N 驱动并执行限位',()=>{
  const engine=new ArmPhysics(definition());
  near(engine.getNativeTip()[2],.3);near(engine.inertia[0],2);near(engine.gravityTorque[0],-19.62);
  engine.set([.2],'position');for(let i=0;i<300;i++)engine.step();near(engine.getNativeTip()[2],.2+engine.q[0]);
  assert.ok(engine.q[0]>.199&&engine.q[0]<.201);
  assert.throws(()=>engine.set([.6],'position'),/关节位移.*m 内/);
  assert.throws(()=>engine.set([.3],'velocity'),/m\/s/);
  assert.throws(()=>engine.set([41],'torque'),/N 内/);
  engine.set([.2],'velocity');for(let i=0;i<500;i++)engine.step();near(engine.q[0],.5);
});

test('continuous 关节支持多圈目标与初始值，不应用单圈硬限位',()=>{
  const model=definition('revolute');Object.assign(model.joints[0],{continuous:true,q0:Math.PI*4,lower:-Math.PI,upper:Math.PI,maxVelocity:4});
  validateDefinition(model);const engine=new ArmPhysics(model);engine.gravity=false;
  engine.set([Math.PI*5],'position');for(let i=0;i<600;i++)engine.step();assert.ok(Math.abs(engine.q[0]-Math.PI*5)<.0001);
  engine.set([4],'velocity');for(let i=0;i<1200;i++)engine.step();assert.ok(engine.q[0]>Math.PI*10);
});

test('固定附件质量与 COM 进入重力/有效质量，删除关节时清理附件及 visual',()=>{
  const model=definition(),attachment=identity();attachment[11]=.2;
  model.extraBodies=[{anchor:0,attachment,mass:1,com:[0,0,.1]}];
  const engine=new ArmPhysics(model);near(engine.inertia[0],3);near(engine.gravityTorque[0],-29.43);
  near(engine.centers[1],engine.chain.centers[0][1]+.1);
  const before=modelFingerprint(model);model.renderVisuals=[{anchor:0,attachment:identity(),origin:{xyz:[0,0,0],rpy:[0,0,0]},type:'sphere',radius:.05}];
  assert.equal(modelFingerprint(model),before,'视觉参数不影响运动学指纹');
  const larger=resizeDefinition(model,2);assert.equal(larger.joints[1].a,null);
  larger.extraBodies.push({...model.extraBodies[0],anchor:1});larger.renderVisuals.push({...model.renderVisuals[0],anchor:1});
  const reduced=resizeDefinition(larger,1);assert.equal(reduced.extraBodies.length,1);assert.equal(reduced.renderVisuals.length,1);
});
