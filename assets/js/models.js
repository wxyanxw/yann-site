export const MEMORY_BUDGET = 32 * 1024 * 1024;
export const BYTES_PER_JOINT = 2048;
export const PRESETS = [
  {id:'single',label:'单轴转台',dof:1},
  {id:'planar3',label:'三轴平面臂',dof:3},
  {id:'industrial6',label:'六轴空间臂',dof:6},
  {id:'nero7',label:'NERO · 七轴（URDF）',dof:7},
];

export function validateDOF(n) {
  if(!Number.isSafeInteger(n)||n<1)throw new Error('轴数必须是大于或等于 1 的整数。');
  if(n*BYTES_PER_JOINT>MEMORY_BUDGET)throw new Error(`该模型超出 32 MB 关节数据预算（本次最多 ${MEMORY_BUDGET/BYTES_PER_JOINT} 轴），请减小轴数。`);
  return n;
}

export function dhJoint(index,params={}) {
  return {kind:'dh',name:`joint${index+1}`,a:.15,alpha:0,d:0,offset:0,q0:0,
    lower:-Math.PI,upper:Math.PI,maxVelocity:6,maxTorque:100,mass:.45,configured:true,...params};
}

export function createPreset(id) {
  if(id==='nero7')throw new Error('NERO 预设需要加载本站的 URDF 定义文件。');
  const base={xyz:[0,.12,0],rpy:[-Math.PI/2,0,0]};
  let joints,label;
  if(id==='single') {joints=[dhJoint(0,{a:.32})];label='单轴转台';}
  else if(id==='planar3') {joints=[.48,.36,.22].map((a,i)=>dhJoint(i,{a,q0:[.35,.55,-.4][i]}));label='三轴平面臂';}
  else if(id==='industrial6') {
    joints=[
      dhJoint(0,{a:.16,d:.28,alpha:-Math.PI/2,q0:-.35}),
      dhJoint(1,{a:.58,q0:-1.05}),
      dhJoint(2,{a:.48,q0:1.4}),
      dhJoint(3,{a:0,d:.13,alpha:Math.PI/2,q0:.15}),
      dhJoint(4,{a:0,d:.1,alpha:-Math.PI/2,q0:.3}),
      dhJoint(5,{a:0,d:.14,q0:.2}),
    ];label='六轴空间臂';
  } else throw new Error('未知预设构型。');
  return {schemaVersion:1,id,label,source:'标准 DH',base,joints,tool:[],notes:['教学用预设，标准 DH：Rz(q+θ₀) Tz(d) Tx(a) Rx(α)。']};
}

export function createGeneric(n) {
  validateDOF(n);
  if(n===1)return createPreset('single');
  if(n===3)return createPreset('planar3');
  if(n===6)return createPreset('industrial6');
  const model=createPreset(n<6?'single':'industrial6');
  for(let i=model.joints.length;i<n;i++)model.joints.push(dhJoint(i));
  model.id='custom';model.label='自定义 DH 构型';return model;
}

export function resizeDefinition(definition,n) {
  validateDOF(n);
  const out=structuredClone(definition),old=out.joints.length;
  out.id='custom';out.label=definition.joints.some(j=>j.kind==='urdf')?`${definition.label.replace(/ 扩展构型$/,'')} 扩展构型`:'自定义 DH 构型';
  out.joints=out.joints.slice(0,n);
  for(let i=old;i<n;i++) {
    const joint=dhJoint(i,{a:null,alpha:null,d:null,offset:null,configured:false});
    // New joints attach after the previous model's fixed tool transform.
    if(i===old&&out.tool?.length)joint.prefix=structuredClone(out.tool);
    out.joints.push(joint);
  }
  if(n!==old)out.tool=[];
  if(n<old){out.extraBodies=(out.extraBodies||[]).filter(b=>b.anchor<n);out.renderVisuals=(out.renderVisuals||[]).filter(v=>v.anchor<n);}
  out.source=out.joints.some(j=>j.kind==='urdf')?'URDF + DH':'标准 DH';return out;
}

const finite=(value,name)=>{if(typeof value!=='number'||!Number.isFinite(value))throw new Error(`${name} 必须填写有限数值。`);};
const vector=(values,name,length=3)=>{
  if(!Array.isArray(values)||values.length!==length)throw new Error(`${name} 需要 ${length} 个值。`);
  values.forEach(v=>finite(v,name));
};
const pose=(value,name)=>{if(!value)throw new Error(`${name} 未定义。`);vector(value.xyz,`${name}.xyz`);vector(value.rpy,`${name}.rpy`);};
const attachment=(value,name)=>{vector(value,name,16);if(value[12]!==0||value[13]!==0||value[14]!==0||value[15]!==1)throw new Error(`${name} 不是有效齐次变换。`);};

export function validateDefinition(definition) {
  if(!definition||!Array.isArray(definition.joints))throw new Error('模型缺少关节定义。');
  validateDOF(definition.joints.length);pose(definition.base,'基座');
  definition.joints.forEach((joint,i)=>{
    const name=`J${i+1}`;
    if(joint.configured!==true)throw new Error(`${name} 的 DH 参数尚未定义，请填写并应用构型。`);
    if(joint.kind==='dh')for(const key of ['a','alpha','d','offset'])finite(joint[key],`${name}.${key}`);
    else if(joint.kind==='urdf') {
      pose(joint.origin,`${name}.origin`);vector(joint.axis,`${name}.axis`);vector(joint.com,`${name}.com`);
      if(Math.hypot(...joint.axis)<1e-12)throw new Error(`${name} 的旋转轴不能为零。`);
      if(joint.inertia){for(const key of ['ixx','ixy','ixz','iyy','iyz','izz'])finite(joint.inertia[key],`${name}.inertia.${key}`);}
      if(joint.motion&&!['revolute','prismatic'].includes(joint.motion))throw new Error(`${name} 不支持该运动类型。`);
    } else throw new Error(`${name} 的关节类型不支持。`);
    for(const prefix of joint.prefix||[])pose(prefix,`${name}.prefix`);
    for(const key of ['lower','upper','q0','maxVelocity','maxTorque','mass'])finite(joint[key],`${name}.${key}`);
    if(joint.lower>=joint.upper)throw new Error(`${name} 的下限必须小于上限。`);
    if(!joint.continuous&&(joint.q0<joint.lower||joint.q0>joint.upper))throw new Error(`${name} 的初始角度超出关节限位。`);
    if(joint.maxVelocity<=0||joint.maxTorque<=0||joint.mass<0)throw new Error(`${name} 的速度/力矩上限须大于零，质量须非负。`);
  });
  for(const tool of definition.tool||[])pose(tool,'工具');
  for(const body of definition.extraBodies||[]) {
    if(!Number.isInteger(body.anchor)||body.anchor<0||body.anchor>=definition.joints.length)throw new Error('固定连杆的 anchor 超出关节链。');
    attachment(body.attachment,'固定连杆 attachment');vector(body.com,'固定连杆 COM');finite(body.mass,'固定连杆 mass');if(body.mass<0)throw new Error('质量不能为负。');
  }
  for(const visual of definition.renderVisuals||[]) {
    if(!Number.isInteger(visual.anchor)||visual.anchor< -1||visual.anchor>=definition.joints.length)throw new Error('visual anchor 超出关节链。');
    attachment(visual.attachment,'visual attachment');pose(visual.origin,'visual origin');
    if(visual.type==='box'){vector(visual.size,'box.size');if(visual.size.some(v=>v<=0))throw new Error('box 尺寸须大于零。');}
    else if(['sphere','cylinder'].includes(visual.type)){finite(visual.radius,'visual radius');if(visual.radius<=0)throw new Error('半径须大于零。');if(visual.type==='cylinder'){finite(visual.length,'cylinder length');if(visual.length<=0)throw new Error('长度须大于零。');}}
    else throw new Error('不支持的 visual 几何。');
    if(visual.color){vector(visual.color,'visual color',4);if(visual.color.some(v=>v<0||v>1))throw new Error('材质颜色须在 [0, 1] 内。');}
  }
  return definition;
}

export function modelFingerprint(definition) {
  let hash=2166136261;
  const data={base:definition.base,joints:definition.joints,tool:definition.tool};
  if(definition.extraBodies?.length)data.extraBodies=definition.extraBodies;
  for(const c of JSON.stringify(data))hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;
  return hash.toString(16);
}
