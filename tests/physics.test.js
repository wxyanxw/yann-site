import test from 'node:test';
import assert from 'node:assert/strict';
import { ArmPhysics, DT, validateDOF } from '../assets/js/physics.js';

test('任意轴数创建完整状态，拒绝无效输入和超预算分配', () => {
  for (const n of [1,3,6,7,129,1000]) {
    const arm=new ArmPhysics(n);
    assert.equal(arm.q.length,n); assert.equal(arm.points.length,(n+1)*3);
    arm.step(); assert.ok(arm.q.every(Number.isFinite));
  }
  for (const n of [0,-1,1.5,Infinity,NaN,Number.MAX_SAFE_INTEGER]) assert.throws(()=>validateDOF(n));
});

test('位置驱动按真实时间逐步收敛，保留惯量响应', () => {
  const arm=new ArmPhysics(6),initial=arm.q[0];
  const target=Array.from(arm.q); target[0]=.6;arm.set(target,'position');
  arm.step();assert.notEqual(arm.q[0],initial);assert.ok(arm.q[0]<target[0]);
  for(let k=0;k<360;k++)arm.step();
  assert.ok(Math.abs(arm.q[0]-.6)<.001);assert.ok(Math.abs(arm.time-361*DT)<1e-9);
});

test('速度控制与力矩控制响应、角限位和输入单位检查', () => {
  const arm=new ArmPhysics(1);arm.gravity=false;
  arm.set([.5],'velocity');for(let k=0;k<120;k++)arm.step();
  assert.ok(arm.dq[0]>.4);const previous=arm.q[0];
  arm.set([1],'torque');for(let k=0;k<120;k++)arm.step();
  assert.ok(arm.q[0]>previous);assert.ok(arm.q[0]<=Math.PI);
  assert.throws(()=>arm.set([],'position'),/需要 1/);
  assert.throws(()=>arm.set([NaN],'position'),/有限数值/);
  assert.throws(()=>arm.set([4],'position'),/角度/);
  assert.throws(()=>arm.set([7],'velocity'),/角速度/);
  assert.throws(()=>arm.set([101],'torque'),/力矩/);
  assert.throws(()=>arm.step(.2),/dt/);
});

test('重力产生力矩响应，关闭重力后静止力矩模式保持静止', () => {
  const on=new ArmPhysics(6),off=new ArmPhysics(6);off.gravity=false;
  on.set(new Array(6).fill(0),'torque');off.set(new Array(6).fill(0),'torque');
  for(let k=0;k<20;k++){on.step();off.step();}
  assert.ok(on.dq.some(v=>Math.abs(v)>.01));assert.ok(off.dq.every(v=>v===0));
});

test('地面接触阻止穿透，完整快照可恢复不同控制模式', () => {
  const arm=new ArmPhysics(6);const target=Array.from(arm.q);target[1]=Math.PI/2;arm.set(target,'position');
  for(let k=0;k<600;k++)arm.step();
  for(let i=1;i<=arm.n;i++)assert.ok(arm.points[i*3+1]>=.025);
  assert.ok(arm.contacts>0);
  arm.set(new Array(6).fill(.2),'velocity');const state=arm.snapshot();
  const restored=new ArmPhysics(6);restored.restore(state);assert.deepEqual(restored.snapshot(),state);
});
