import { validateDefinition, validateDOF } from './models.js';
import { identity, multiply, poseTransform, forwardChain } from './kinematics.js';

export const URDF_FILE_LIMIT = 5 * 1024 * 1024;
const children=(node,name)=>Array.from(node.children).filter(child=>child.localName===name);
const child=(node,name)=>children(node,name)[0];
const number=(value,label,fallback)=>{
  if(value===null||value===undefined){if(fallback!==undefined)return fallback;throw new Error(`${label} 缺少数值。`);}
  if(String(value).trim()===''||!Number.isFinite(Number(value)))throw new Error(`${label} 必须是有限数值（请先展开 xacro）。`);
  return Number(value);
};
const vector=(value,label,defaults=[0,0,0])=>{
  if(value===null||value===undefined)return defaults.slice();
  const items=value.trim().split(/\s+/);
  if(items.length!==defaults.length)throw new Error(`${label} 需要 ${defaults.length} 个值。`);
  return items.map(v=>number(v,label));
};
const pose=(node,label)=>{
  const origin=child(node,'origin');
  return {xyz:vector(origin?.getAttribute('xyz'),`${label}.xyz`),rpy:vector(origin?.getAttribute('rpy'),`${label}.rpy`)};
};
const named=(node,label)=>{const name=node.getAttribute('name');if(!name?.trim())throw new Error(`${label} 缺少 name。`);return name;};

// DOMParser is a browser XML parser; no remote mesh, texture or entity is loaded.
export function parseURDF(text,{filename='robot.urdf'}={}) {
  if(typeof text!=='string'||new TextEncoder().encode(text).length>URDF_FILE_LIMIT)throw new Error('URDF 文件须小于 5 MB。');
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('不支持包含 DTD 或外部实体的 XML，请上传标准 URDF。');
  const document=new DOMParser().parseFromString(text,'application/xml');
  if(document.getElementsByTagName('parsererror').length||document.documentElement?.localName!=='robot')throw new Error('URDF XML 解析失败：需要完整的 <robot> 文档。');
  const root=document.documentElement,links=new Map(),joints=new Map(),incoming=new Map(),outgoing=new Map();
  for(const link of children(root,'link')) {
    const name=named(link,'link');if(links.has(name))throw new Error(`重复的 link 名称：${name}`);links.set(name,link);
  }
  if(!links.size)throw new Error('URDF 没有 link。');
  if(links.size>32768)throw new Error('URDF 连杆数量超出浏览器模型预算。');
  for(const element of children(root,'joint')) {
    const name=named(element,'joint');if(joints.has(name))throw new Error(`重复的 joint 名称：${name}`);
    const parent=child(element,'parent')?.getAttribute('link'),next=child(element,'child')?.getAttribute('link');
    if(!links.has(parent)||!links.has(next))throw new Error(`${name} 的 parent/child 引用了不存在的 link。`);
    if(incoming.has(next))throw new Error(`${next} 有多个父关节，URDF 必须是树。`);
    const joint={name,parent,child:next,type:element.getAttribute('type'),element};
    joints.set(name,joint);incoming.set(next,joint);if(!outgoing.has(parent))outgoing.set(parent,[]);outgoing.get(parent).push(joint);
  }
  const roots=[...links.keys()].filter(name=>!incoming.has(name));
  if(roots.length!==1)throw new Error('URDF 必须包含一个根连杆；检测到断开的连杆或循环。');
  const visited=new Set(),stack=[roots[0]],metadata=new Map([[roots[0],{dof:0,invalid:null}]]);
  while(stack.length) {
    const name=stack.pop();if(visited.has(name))throw new Error('URDF 关节链存在循环。');visited.add(name);
    for(const joint of outgoing.get(name)||[]) {
      const state=metadata.get(name),invalid=state.invalid||(!['fixed','revolute','continuous','prismatic'].includes(joint.type)||child(joint.element,'mimic')?joint:null);
      metadata.set(joint.child,{dof:state.dof+(joint.type==='fixed'?0:1),invalid});stack.push(joint.child);
    }
  }
  if(visited.size!==links.size)throw new Error('URDF 存在不连通的连杆或循环。');
  const candidates=[];
  for(const [name,{dof,invalid}] of metadata) {
    if(!dof)continue;
    const leaf=!outgoing.has(name);
    candidates.push({tip:name,dof,leaf,
      supported:!invalid,reason:invalid?(child(invalid.element,'mimic')?`${invalid.name} 使用 mimic 联动`:`${invalid.name} 使用 ${invalid.type} 关节`):''});
  }
  if(!candidates.length)throw new Error('URDF 没有可控制关节。');
  const supported=candidates.filter(x=>x.supported);
  if(!supported.length)throw new Error('没有可导入的机械臂链；当前支持 fixed、revolute、continuous、prismatic，暂不支持 mimic、floating、planar。');
  const defaultTip=supported.filter(x=>x.leaf).sort((a,b)=>b.dof-a.dof)[0]?.tip||supported.sort((a,b)=>b.dof-a.dof)[0].tip;
  const paths={get(tip){if(!links.has(tip))return undefined;const path=[];let current=tip;while(incoming.has(current)){const joint=incoming.get(current);path.push(joint);current=joint.parent;}return path.reverse();}};
  return {name:root.getAttribute('name')||filename.replace(/\.urdf$/i,''),filename,text,links,joints,incoming,outgoing,paths,candidates,rootLink:roots[0],defaultTip};
}

function inertial(link,name,notes) {
  const inertial=child(link,'inertial');
  if(!inertial){notes.add(`${name} 未提供惯性数据，仿真使用 0.45 kg 和简化惯量；不代表硬件。`);return {mass:.45,com:[0,0,0],inertialRPY:[0,0,0]};}
  const mass=number(child(inertial,'mass')?.getAttribute('value'),`${name}.mass`);
  if(mass<0)throw new Error(`${name} 的质量不能为负。`);
  const transform=pose(inertial,name),tensor=child(inertial,'inertia');
  const result={mass,com:transform.xyz,inertialRPY:transform.rpy};
  if(tensor){result.inertia={};for(const key of ['ixx','ixy','ixz','iyy','iyz','izz'])result.inertia[key]=number(tensor.getAttribute(key),`${name}.${key}`);if(['ixx','iyy','izz'].some(key=>result.inertia[key]<0))throw new Error(`${name} 的主惯量不能为负。`);}
  else notes.add(`${name} 未提供惯性张量，使用简化数值惯量。`);
  if(mass===0)notes.add(`${name} 的源质量为 0；保留质量并使用最小数值惯量稳定积分。`);
  return result;
}

function visuals(link,robot,notes) {
  const out=[];
  for(const element of children(link,'visual')) {
    const geometry=child(element,'geometry'),shape=geometry&&Array.from(geometry.children)[0];if(!shape)continue;
    const type=shape.localName;
    if(type==='mesh'){notes.add('URDF 引用了独立 mesh 文件；本次仅上传 URDF，外形采用圆润示意模型，不下载外部网格。');continue;}
    const spec={type,origin:pose(element,'visual')};
    if(type==='box')spec.size=vector(shape.getAttribute('size'),'box.size');
    else if(type==='cylinder'){spec.radius=number(shape.getAttribute('radius'),'cylinder.radius');spec.length=number(shape.getAttribute('length'),'cylinder.length');}
    else if(type==='sphere')spec.radius=number(shape.getAttribute('radius'),'sphere.radius');
    else {notes.add(`未显示 ${type} visual 几何。`);continue;}
    if((spec.size||[spec.radius,spec.length].filter(x=>x!==undefined)).some(x=>x<=0))throw new Error('visual 尺寸须大于 0。');
    let material=child(element,'material'),color=material&&child(material,'color');
    if(material&&!color&&material.getAttribute('name'))color=children(robot,'material').filter(m=>m.getAttribute('name')===material.getAttribute('name')).map(m=>child(m,'color')).find(Boolean);
    if(color){spec.color=vector(color.getAttribute('rgba'),'material.rgba',[.8,.8,.8,1]);if(spec.color.some(v=>v<0||v>1))throw new Error('材质 rgba 须位于 [0, 1]。');}
    out.push(spec);
  }
  return out;
}

export async function buildURDFDefinition(parsed,tip=parsed.defaultTip) {
  const path=parsed.paths.get(tip);if(!path)throw new Error('选择的末端连杆不存在。');
  const candidate=parsed.candidates.find(c=>c.tip===tip);if(!candidate?.supported)throw new Error(candidate?.reason||'选中的链没有可控制关节。');
  validateDOF(candidate.dof);
  const notes=new Set(['按选定的根连杆 → 末端链导入，origin / axis 保留源精度；分支不会混入控制数组。']);
  const joints=[],fixed=[],extraBodies=[],renderVisuals=[];
  let anchor=-1,attachment=identity();
  const addLink=(name,isFixed)=>{
    const link=parsed.links.get(name);
    for(const visual of visuals(link,parsed.links.get(parsed.rootLink).parentElement,notes))renderVisuals.push({anchor,attachment:attachment.slice(),...visual});
    if(isFixed&&anchor>=0&&child(link,'inertial'))extraBodies.push({anchor,attachment:attachment.slice(),...inertial(link,name,notes)});
  };
  addLink(parsed.rootLink,false);
  for(const entry of path) {
    const {element,name,type}=entry,origin=pose(element,name);
    if(type==='fixed') {
      fixed.push({...origin,name});attachment=multiply(attachment,poseTransform(origin));addLink(entry.child,true);continue;
    }
    const limit=child(element,'limit'),linear=type==='prismatic',continuous=type==='continuous';
    const axis=vector(child(element,'axis')?.getAttribute('xyz'),`${name}.axis`,[1,0,0]);
    if(Math.hypot(...axis)<1e-12)throw new Error(`${name} 的 axis 不能为零。`);
    const lower=continuous?-Math.PI:number(limit?.getAttribute('lower'),`${name}.lower`);
    const upper=continuous?Math.PI:number(limit?.getAttribute('upper'),`${name}.upper`);
    const sourceVelocity=number(limit?.getAttribute('velocity'),`${name}.velocity`,0),sourceEffort=number(limit?.getAttribute('effort'),`${name}.effort`,0);
    if(sourceVelocity<0||sourceEffort<0)throw new Error(`${name} 的速度/力矩上限不能为负。`);
    if(!sourceVelocity||!sourceEffort)notes.add(`${name} 未提供有效驱动上限：仿真速度 ${sourceVelocity|| (linear ? .2 : 2)} ${linear?'m/s':'rad/s'}、${linear?'力':'力矩'} ${sourceEffort||30} ${linear?'N':'N·m'}。`);
    if(!continuous&&(lower>0||upper<0))notes.add(`${name} 的零位超出源限位，仿真初始位置采用 ${Math.max(lower,Math.min(upper,0))} ${linear?'m':'rad'}。`);
    joints.push({kind:'urdf',name,parent:entry.parent,child:entry.child,origin,axis,prefix:fixed.splice(0),
      motion:linear?'prismatic':'revolute',continuous,lower,upper,q0:Math.max(lower,Math.min(upper,0)),
      maxVelocity:sourceVelocity||(linear ? .2 : 2),maxTorque:sourceEffort||30,sourceVelocity,sourceEffort,
      configured:true,...inertial(parsed.links.get(entry.child),entry.child,notes)});
    anchor=joints.length-1;attachment=identity();addLink(entry.child,false);
  }
  const model={schemaVersion:1,id:'custom',label:parsed.name,source:'URDF 上传',sourceFile:parsed.filename,
    rootLink:parsed.rootLink,tipLink:tip,base:{xyz:[0,.08,0],rpy:[-Math.PI/2,0,0]},
    joints,tool:fixed,extraBodies,renderVisuals,uploadedURDF:parsed.text,notes:[]};
  const fk=forwardChain(model,joints.map(j=>j.q0));
  let bottom=.08;for(const origin of fk.origins)bottom=Math.min(bottom,origin[1]);bottom=Math.min(bottom,fk.tip[1]);
  model.base.xyz[1]+=(Math.max(0,.04-bottom));
  const validTips=parsed.candidates.filter(c=>c.leaf).length;
  if(validTips>1)notes.add(`URDF 有 ${validTips} 个末端分支；当前仅导入 ${parsed.rootLink} → ${tip}。`);
  if(joints.some(j=>j.continuous))notes.add('continuous 关节不施加旋转硬限位；界面提供 ±180° 的单圈控制窗口。');
  notes.add('文件在本地浏览器解析，不上传到服务器。基本 visual 几何可显示，缺少的网格使用示意外壳。');
  if(globalThis.crypto?.subtle){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(parsed.text));model.sourceSHA256=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
  model.notes=[...notes];return validateDefinition(model);
}
