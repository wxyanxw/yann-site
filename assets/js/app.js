import { ArmPhysics, DT, RENDER_LIMIT, validateDOF } from './physics.js';
import { RobotScene } from './scene.js';
import { createPreset, resizeDefinition, validateDefinition, modelFingerprint } from './models.js';
import { GeometryEditor } from './geometry-editor.js';
import { URDFImporter } from './urdf-importer.js';

const $ = id => document.getElementById(id);
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key,value) { try { localStorage.setItem(key,value); return true; } catch { return false; } },
};
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function savedModel() {
  try { return validateDefinition(JSON.parse(storage.get('yann.lab.geometry.v1'))); }
  catch { return createPreset('industrial6'); }
}
let engine = new ArmPhysics(savedModel()), heroEngine = new ArmPhysics(6);
let geometryEditing=false, loadingModel=false, presetRequest=0;
const geometryEditor = new GeometryEditor({onApply:applyDefinition,onCancel:()=>{geometryEditing=false;updateConfig();updateRunningUI();}});
let heroScene, labScene, isLab = false, manualActive = false, paused = false, running = false;
let worker = null, runtimeReady = false, heartbeat = 0, startedAt = 0, watchdog = null;
let jointPage = 0, speed = 1, logCount = 0, toastTimer, saveTimer;
let lastFrame = performance.now(), accumulator = 0, uiTick = 0, fpsFrames = 0, fpsTime = performance.now();
const draftKey = model => `yann.lab.controller.v2.${modelFingerprint(model)}`;
const modes = {position:'位置控制',velocity:'速度控制',torque:'力矩控制'};

export function demo(model) {
  const n=typeof model==='number'?model:model.joints.length;
  const linear=typeof model==='number'?[]:model.joints.flatMap((j,i)=>j.motion==='prismatic'?[i]:[]);
  return `# ${n} 轴机械臂 · 平滑关节运动示例\n# 旋转：rad；直线：m；按 Ctrl / ⌘ + Enter 运行\nimport math\nfrom arm import Robot\n\nrobot = Robot(dof=${n})\nlinear_joints = ${JSON.stringify(linear)}\n\nasync def main():\n    home = robot.get_joint_positions()\n    print(f"已连接 {robot.dof} 轴机械臂")\n\n    # 数组长度与轴数一致；按关节类型选择单位\n    target = home.copy()\n    limits = robot.get_joint_limits()\n    target[0] = max(limits[0][0], min(limits[0][1], home[0] + 0.04 if 0 in linear_joints else math.radians(45)))\n    if robot.dof > 1:\n        delta = 0.02 if 1 in linear_joints else math.radians(10)\n        target[1] = max(limits[1][0], min(limits[1][1], home[1] + delta))\n\n    await robot.move_joints(target, duration=2.0)\n    print("目标已到达，准备返回初始姿态")\n    await robot.move_joints(home, duration=2.0)\n    print(f"运动完成 · 仿真时间 {robot.time:.2f} s")\n\nawait main()\n`;
}

function toast(message) {
  $('toast').textContent=message; $('toast').classList.add('show'); clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4200);
}

function setupScene(id,model,hero=false) {
  try { return new RobotScene($(id),model,hero); }
  catch (error) {
    const message=document.createElement('div'); message.className='scene-error';
    message.innerHTML='<svg class="icon"><use href="#i-arm"/></svg><b>三维视图暂不可用</b><span>请使用支持 WebGL 的浏览器并启用硬件加速。<br>关节接口与 Python 编辑器仍可使用。</span>';
    $(id).querySelector('canvas')?.remove(); $(id).appendChild(message);
    console.warn('WebGL initialization failed:',error); return null;
  }
}

function route() {
  isLab=location.hash==='#lab';
  fpsFrames=0;fpsTime=performance.now();
  $('home-page').hidden=isLab; $('lab-page').hidden=!isLab;
  document.querySelectorAll('[data-nav]').forEach(x=>{const active=x.dataset.nav===(isLab?'lab':'home');x.classList.toggle('active',active);if(active)x.setAttribute('aria-current','page');else x.removeAttribute('aria-current');});
  document.title=isLab?'机械臂实验室 — yann':'yann — 让想法动起来';
  if (isLab && labScene===undefined) labScene=setupScene('lab-scene',engine);
  if (!isLab && heroScene===undefined) heroScene=setupScene('hero-scene',heroEngine,true);
  requestAnimationFrame(()=>{(isLab?labScene:heroScene)?.resize();});
  window.scrollTo({top:0,behavior:'instant'});
}

function rangePaint(input) {
  const percent=(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100;
  input.style.setProperty('--range-progress',`${percent}%`);
}

const displayScale=joint=>joint.motion==='prismatic'?1000:180/Math.PI;
const displayUnit=joint=>joint.motion==='prismatic'?'mm':'°';
const sliderValue=(joint,q)=>joint.continuous?((q+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)*180/Math.PI-180:q*displayScale(joint);

function buildJoints() {
  const start=jointPage*6,end=Math.min(engine.n,start+6);
  $('joint-controls').replaceChildren();
  for(let i=start;i<end;i++) {
    const joint=engine.definition.joints[i],scale=displayScale(joint),unit=displayUnit(joint);
    const div=document.createElement('div');div.className='joint-control';
    const value=(engine.q[i]*scale).toFixed(1);
    div.innerHTML=`<label for="joint-${i}"><span><i></i>J${String(i+1).padStart(2,'0')}${joint.motion==='prismatic'?' ↔':joint.continuous?' ∞':''}</span><output id="joint-value-${i}" for="joint-${i}">${value}${unit}</output></label><input id="joint-${i}" type="range" min="${joint.lower*scale}" max="${joint.upper*scale}" step="0.1" value="${sliderValue(joint,engine.q[i])}" aria-label="关节 ${i+1} 目标${joint.motion==='prismatic'?'位移 mm':'角度'}">`;
    const input=div.querySelector('input');rangePaint(input);
    input.disabled=running;
    input.addEventListener('input',()=>{
      if(running)return;
      const targets=engine.mode==='position'?engine.target.slice():engine.q.slice();
      const desired=Number(input.value)/scale;
      targets[i]=joint.continuous?desired+Math.round((engine.q[i]-desired)/(2*Math.PI))*2*Math.PI:Math.max(joint.lower,Math.min(joint.upper,desired));
      engine.set(targets,'position');manualActive=true;
      $(`joint-value-${i}`).textContent=`${(targets[i]*scale).toFixed(1)}${unit}`;rangePaint(input);
      setSimStatus(paused?'仿真已暂停':'关节运动中');
    });
    $('joint-controls').appendChild(div);
  }
  $('joint-pagination').hidden=engine.n<=6;
  $('joint-page-label').textContent=`${start+1}–${end} / ${engine.n}`;
  $('joint-prev').disabled=jointPage===0;$('joint-next').disabled=end>=engine.n;
}

function updateConfig() {
  $('axis-count').value=engine.n;
  document.querySelectorAll('[data-axes]').forEach(x=>x.classList.toggle('selected',Number(x.dataset.axes)===engine.n));
  $('dof-badge').textContent=`${engine.n} DOF`;$('api-model').textContent=`Robot(dof=${engine.n})`;
  $('api-dof').textContent=engine.n;$('api-length').textContent=engine.n;
  const linear=engine.definition.joints.filter(j=>j.motion==='prismatic').length;
  $('config-summary').textContent=linear?`${engine.n-linear} 旋转 + ${linear} 直线关节已就绪`:`${engine.n} 个旋转关节已就绪`;
  $('joint-units').textContent=linear?'DEG / MM':'DEG';
  $('axis-minus').disabled=engine.n===1;
  $('model-preset').value=engine.definition.id==='custom'?'custom':engine.definition.id;
  $('model-source').textContent=`${engine.definition.label} · ${engine.definition.source}`;
  $('viewport-model-label').textContent=engine.definition.joints.some(j=>j.kind==='urdf')?(engine.definition.id==='nero7'?'NERO / PRECISION SHELL':'CUSTOM / URDF'):'STANDARD DH';
  $('axis-help').textContent=engine.n>RENDER_LIMIT?`已定义 ${engine.n} 轴；视图仅显示前 ${RENDER_LIMIT} 轴。增加轴后须填写 DH 参数。`:'增加轴后须填写新关节的 DH 参数。修改轴数保留已有关节几何。';
  buildJoints();updateTelemetry();
}

function applyDefinition(definition) {
  validateDefinition(definition);
  saveCode();
  if(running)stopCode('构型变更，已停止当前程序');
  const changed=modelFingerprint(definition)!==modelFingerprint(engine.definition);
  if(changed&&geometryEditing&&definition.id===engine.definition.id&&definition.id!=='custom') {
    definition.id='custom';definition.label=definition.joints.some(j=>j.kind==='urdf')?`${definition.label} 自定义构型`:'自定义 DH 构型';
  }
  engine=new ArmPhysics(definition);engine.gravity=$('gravity-toggle').checked;
  geometryEditing=false;loadingModel=false;jointPage=0;manualActive=false;accumulator=0;paused=false;updatePauseButton();
  labScene?.buildRobot(engine);updateConfig();updateRunningUI();
  const savedGeometry=storage.set('yann.lab.geometry.v1',JSON.stringify(engine.definition));
  if(engine.definition.id==='custom')storage.set('yann.lab.custom-geometry.v1',JSON.stringify(engine.definition));
  loadCode(storage.get(draftKey(engine.definition))??demo(engine.definition));
  setSimStatus('等待控制指令');
  toast(!savedGeometry?'构型已应用，但浏览器存储已满；请导出构型 JSON 保存。':engine.n>RENDER_LIMIT?`${engine.n} 轴构型已应用；视图显示前 ${RENDER_LIMIT} 个关节。`:`${engine.definition.label}已应用`);
}

function openGeometry(definition=engine.definition) {
  presetRequest++;loadingModel=false;
  if(running)stopCode('编辑构型，已停止当前程序');
  geometryEditing=true;updateRunningUI();geometryEditor.open(definition);
}

function selectAxes(n) {
  try { validateDOF(n); } catch(error) { toast(error.message);$('axis-count').value=engine.n;return; }
  if(n===engine.n)return;
  const draft=resizeDefinition(engine.definition,n);
  $('config-summary').textContent=`${n} 轴构型待应用`;
  openGeometry(draft);
}

async function selectPreset(id) {
  const request=++presetRequest;
  if(id==='custom') {
    let definition=engine.definition;
    try{definition=validateDefinition(JSON.parse(storage.get('yann.lab.custom-geometry.v1')));}catch{}
    openGeometry(definition);return;
  }
  loadingModel=true;updateRunningUI();
  try {
    let definition;
    if(id==='nero7') {
      $('model-source').textContent='正在加载 NERO 原始 URDF 构型…';
      const response=await fetch(new URL('../models/nero/definition.json',import.meta.url));
      if(!response.ok)throw new Error(`NERO 构型加载失败：HTTP ${response.status}`);
      definition=validateDefinition(await response.json());
    } else definition=createPreset(id);
    if(request!==presetRequest)return;
    applyDefinition(definition);
  } catch(error) { if(request===presetRequest){toast(error.message);updateConfig();} }
  finally {if(request===presetRequest){loadingModel=false;updateRunningUI();}}
}

function resetArm() {
  if(running)stopCode('机械臂已重置');
  engine=new ArmPhysics(engine.definition);engine.gravity=$('gravity-toggle').checked;
  manualActive=false;paused=false;accumulator=0;updatePauseButton();
  labScene?.buildRobot(engine);buildJoints();updateTelemetry();setSimStatus('等待控制指令');
  toast('机械臂已回到初始姿态');
}

function setSimStatus(text) { $('sim-status').innerHTML='<span class="status-dot"></span>'; $('sim-status').append(document.createTextNode(text)); }

function updateTelemetry() {
  $('sim-time').innerHTML=`${engine.time.toFixed(2)} <small>s</small>`;
  const tip=engine.getNativeTip();
  $('tip-position').textContent=Array.from(tip,x=>x.toFixed(3)).join(' / ');
  $('tip-position').title='原生基座坐标 X / Y / Z，单位：米（与 Python 位姿一致）';$('control-mode').textContent=modes[engine.mode];
  for(let i=jointPage*6;i<Math.min(engine.n,(jointPage+1)*6);i++) {
    const input=$(`joint-${i}`),output=$(`joint-value-${i}`);
    if(document.activeElement!==input) { const joint=engine.definition.joints[i];input.value=sliderValue(joint,engine.q[i]);rangePaint(input);output.textContent=`${(engine.q[i]*displayScale(joint)).toFixed(1)}${displayUnit(joint)}`; }
  }
}

function escapeHTML(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function highlight(code) {
  const pattern=/(#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:async|await|def|class|import|from|as|if|else|elif|for|while|in|return|with|try|except|finally|raise|pass|break|continue|and|or|not|is|None|True|False)\b|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*(?=\s*\())/g;
  let result='',last=0;
  for(const match of code.matchAll(pattern)) {
    result+=escapeHTML(code.slice(last,match.index));
    const token=match[0],type=token.startsWith('#')?'comment':/^['"]/.test(token)?'string':/^\d/.test(token)?'number':/^(async|await|def|class|import|from|as|if|else|elif|for|while|in|return|with|try|except|finally|raise|pass|break|continue|and|or|not|is|None|True|False)$/.test(token)?'keyword':'function';
    result+=`<span class="token-${type}">${escapeHTML(token)}</span>`;last=match.index+token.length;
  }
  return result+escapeHTML(code.slice(last))+'\n';
}

function refreshEditor() {
  const value=$('code-input').value;
  $('highlighted-code').innerHTML=highlight(value);
  $('line-numbers').textContent=Array.from({length:value.split('\n').length},(_,i)=>i+1).join('\n');
  syncScroll();cursorPosition();
}
function syncScroll() { $('code-highlight').scrollTop=$('code-input').scrollTop;$('code-highlight').scrollLeft=$('code-input').scrollLeft;$('line-numbers').scrollTop=$('code-input').scrollTop; }
function cursorPosition() {
  const before=$('code-input').value.slice(0,$('code-input').selectionStart),lines=before.split('\n');
  $('cursor-position').textContent=`Ln ${lines.length}, Col ${lines.at(-1).length+1}`;
}
function loadCode(value) { clearTimeout(saveTimer);$('code-input').value=value;refreshEditor();saveCode(); }
function saveCode() { clearTimeout(saveTimer);const saved=storage.set(draftKey(engine.definition),$('code-input').value);$('unsaved-dot').title=saved?'已自动保存到浏览器':'浏览器存储不可用，请下载代码';$('unsaved-dot').style.color=saved?'#6c8069':'#fa8b50'; }

function log(text,type='stdout') {
  if(!logCount)$('console-output').replaceChildren();
  logCount++;$('console-count').textContent=logCount;
  const row=document.createElement('div');row.className=`console-line log-${type}`;
  const time=document.createElement('span');time.className='log-time';time.textContent=new Date().toLocaleTimeString('zh-CN',{hour12:false}).slice(3);
  const message=document.createElement('span');message.className='log-message';message.textContent=String(text).slice(0,6000);
  row.append(time,message);$('console-output').appendChild(row);
  while($('console-output').children.length>250)$('console-output').firstChild.remove();
  $('console-output').scrollTop=$('console-output').scrollHeight;
}

function updateRunningUI() {
  $('run-code').disabled=running||geometryEditing||loadingModel;$('run-code').querySelector('span').textContent=running?(runtimeReady?'运行中':'加载 Python…'):'运行代码';
  $('stop-code').hidden=!running;
  document.querySelectorAll('#joint-controls input').forEach(x=>x.disabled=running);
}

function updatePauseButton() {
  const b=$('pause-sim');b.innerHTML=`<svg class="icon"><use href="#i-${paused?'play':'pause'}"/></svg>`;
  b.title=paused?'继续仿真':'暂停仿真';b.setAttribute('aria-label',b.title);b.classList.toggle('active',paused);b.setAttribute('aria-pressed',String(paused));
}

function finishCode(status='运行完成') {
  running=false;clearInterval(watchdog);watchdog=null;paused=false;updatePauseButton();updateRunningUI();
  $('execution-status').textContent=status;
  $('python-status').textContent=runtimeReady?'Python 运行时已就绪':'Python 运行时 · 按需加载';
  setSimStatus(status);manualActive=true;
}

function stopCode(reason='已停止运行') {
  worker?.terminate();worker=null;runtimeReady=false;finishCode(reason);
  engine.mode='position';engine.target.set(engine.q);engine.dq.fill(0);manualActive=false;
  log(reason,'info');
}

function runCode() {
  if(running)return;
  if(geometryEditing||loadingModel){toast('请先应用完整的关节构型。');return;}
  if(!$('code-input').value.trim()){toast('先写一点 Python 代码吧。');return;}
  saveCode();running=true;manualActive=false;paused=false;updatePauseButton();
  engine.time=0;engine.contacts=0;labScene?.clearTrail();accumulator=0;
  $('execution-status').textContent='正在运行';setSimStatus('Python 控制中');
  log(`启动 ${engine.n} 轴控制程序`,'info');
  startedAt=performance.now();heartbeat=startedAt;
  if(!worker) {
    worker=new Worker(new URL('./python-worker.js',import.meta.url),{type:'module'});
    worker.onmessage=({data})=>{
      if(data.type!=='stdout'&&data.type!=='stderr')heartbeat=performance.now();
      if(data.type==='loading'){log(data.message,'info');$('python-status').textContent='首次启动 Python，请稍候…';}
      if(data.type==='ready') {runtimeReady=true;$('python-status').textContent=`Python ${data.version} · 本地运行`;document.querySelector('.editor-language').textContent=`Python ${data.version}`;updateRunningUI();sendSettings();worker?.postMessage({type:'pause',paused});log(`Python ${data.version} 就绪`,'info');}
      if(data.type==='stdout')log(data.text);
      if(data.type==='stderr')log(data.text,'error');
      if(data.type==='frame'&&data.state){engine.restore(data.state);}
      if(data.type==='done'){engine.restore(data.state);log('程序运行完成','success');finishCode();}
      if(data.type==='error') {
        if(data.state)engine.restore(data.state);
        log(data.message,'error');
        if(!runtimeReady){worker.terminate();worker=null;}
        finishCode('运行出错');
      }
    };
    worker.onerror=event=>{log(event.message||'Python Worker 加载失败，请通过 HTTP 服务访问网站。','error');worker?.terminate();worker=null;runtimeReady=false;finishCode('启动失败');};
  }
  updateRunningUI();
  worker.postMessage({type:'run',dof:engine.n,definition:engine.definition,state:engine.snapshot(),gravity:$('gravity-toggle').checked,speed,code:$('code-input').value});
  watchdog=setInterval(()=>{
    if(paused)return;
    const now=performance.now();
    if(runtimeReady&&now-heartbeat>10000)stopCode('代码超过 10 秒未响应，已终止。循环中请使用 await robot.step() 让出执行权。');
    else if(!runtimeReady&&now-startedAt>120000)stopCode('Python 加载超时，请检查本站运行资源后重试。');
  },500);
}

function sendSettings() { worker?.postMessage({type:'settings',gravity:$('gravity-toggle').checked,speed}); }

function animate(now) {
  requestAnimationFrame(animate);
  if(document.hidden){lastFrame=now;return;}
  const delta=Math.min((now-lastFrame)/1000,.05);lastFrame=now;
  if(!isLab) {
    if(!reducedMotion) {
      heroEngine.target[0]=-.35+Math.sin(now*.00018)*.22;
      heroEngine.target[1]=-1.05+Math.sin(now*.00028)*.055;
      heroEngine.step(Math.max(.001,delta));
    }
    heroScene?.update(false);
    if(now-uiTick>120) {
      const p=heroEngine.points,k=heroEngine.n*3;
      $('hero-x').textContent=p[k].toFixed(3);$('hero-y').textContent=p[k+1].toFixed(3);$('hero-z').textContent=p[k+2].toFixed(3);uiTick=now;
    }
    return;
  }
  if(!paused&&!running&&manualActive) {
    accumulator+=delta*speed;let steps=0;
    while(accumulator>=DT&&steps<12){engine.step();accumulator-=DT;steps++;}
    if(engine.mode==='position'&&engine.q.every((q,i)=>Math.abs(q-engine.target[i])<.001)&&engine.dq.every(v=>Math.abs(v)<.003)) {manualActive=false;setSimStatus('关节已到位');}
    if(steps===12)accumulator=0;
  }
  labScene?.update(!paused);
  if(now-uiTick>90){updateTelemetry();uiTick=now;}
  fpsFrames++;
  if(now-fpsTime>1000){$('render-fps').textContent=`${Math.round(fpsFrames*1000/(now-fpsTime))} FPS`;fpsFrames=0;fpsTime=now;}
}

new URDFImporter({
  onOpen:()=>{presetRequest++;loadingModel=false;if(running)stopCode('导入构型，已停止当前程序');geometryEditing=true;updateConfig();updateRunningUI();},
  onReview:definition=>openGeometry(definition),
  onCancel:()=>{geometryEditing=false;updateConfig();updateRunningUI();},
});

// Navigation and homepage placeholders.
window.addEventListener('hashchange',route);
document.querySelectorAll('[data-placeholder]').forEach(x=>x.addEventListener('click',()=>toast(`${x.dataset.placeholder}正在准备中，先来机械臂实验室探索一下吧。`)));
document.querySelectorAll('.current-year').forEach(x=>x.textContent=new Date().getFullYear());
document.querySelectorAll('[data-axes]').forEach(x=>x.addEventListener('click',()=>selectPreset(({1:'single',3:'planar3',6:'industrial6',7:'nero7'})[x.dataset.axes])));
$('model-preset').addEventListener('change',()=>selectPreset($('model-preset').value));
$('edit-geometry').addEventListener('click',()=>openGeometry());
$('axis-count').addEventListener('change',()=>selectAxes(Number($('axis-count').value)));
$('axis-count').addEventListener('keydown',e=>{if(e.key==='Enter'){$('axis-count').blur();}});
$('axis-minus').addEventListener('click',()=>selectAxes(engine.n-1));$('axis-plus').addEventListener('click',()=>selectAxes(engine.n+1));
$('joint-prev').addEventListener('click',()=>{jointPage--;buildJoints();});$('joint-next').addEventListener('click',()=>{jointPage++;buildJoints();});
$('reset-arm').addEventListener('click',resetArm);
$('gravity-toggle').addEventListener('change',()=>{engine.gravity=$('gravity-toggle').checked;sendSettings();if(engine.mode==='torque')manualActive=true;});
$('trail-toggle').addEventListener('change',()=>{if(labScene){labScene.trail.visible=$('trail-toggle').checked;labScene.clearTrail();}});
$('sim-speed').addEventListener('input',()=>{speed=Number($('sim-speed').value);rangePaint($('sim-speed'));$('speed-label').textContent=`${speed.toFixed(2).replace(/0$/,'')}×`;sendSettings();});
$('toggle-grid').addEventListener('click',()=>{if(!labScene)return;labScene.grid.visible=!labScene.grid.visible;$('toggle-grid').classList.toggle('active',labScene.grid.visible);$('toggle-grid').setAttribute('aria-pressed',String(labScene.grid.visible));});
$('reset-camera').addEventListener('click',()=>labScene?.resetCamera());
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.querySelector('.simulator').requestFullscreen();}catch{toast('此浏览器暂不支持全屏模式。');}});
$('pause-sim').addEventListener('click',()=>{paused=!paused;heartbeat=performance.now();updatePauseButton();worker?.postMessage({type:'pause',paused});setSimStatus(paused?'仿真已暂停':running?'Python 控制中':manualActive?'关节运动中':'等待控制指令');});
$('model-info').addEventListener('click',()=>$('info-dialog').showModal());
for(const id of ['close-info','info-ok'])$(id).addEventListener('click',()=>$('info-dialog').close());
$('info-dialog').addEventListener('click',e=>{if(e.target===$('info-dialog')){const r=$('info-dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('info-dialog').close();}});
$('load-demo').addEventListener('click',()=>{loadCode(demo(engine.definition));toast(`${engine.n} 轴控制示例已加载`);});
$('code-input').addEventListener('input',()=>{refreshEditor();$('unsaved-dot').style.color='#fa8b50';$('unsaved-dot').title='正在保存';clearTimeout(saveTimer);saveTimer=setTimeout(saveCode,450);});
$('code-input').addEventListener('scroll',syncScroll);
for(const event of ['click','keyup','select'])$('code-input').addEventListener(event,cursorPosition);
$('code-input').addEventListener('keydown',e=>{
  const input=$('code-input');
  if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();runCode();return;}
  if(e.key==='Tab'){e.preventDefault();input.setRangeText('    ',input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new Event('input'));}
  if(e.key==='Enter'&&!e.ctrlKey&&!e.metaKey) {
    e.preventDefault();const start=input.selectionStart,line=input.value.slice(0,start).split('\n').at(-1),indent=line.match(/^\s*/)[0]+(line.trimEnd().endsWith(':')?'    ':'');
    input.setRangeText('\n'+indent,start,input.selectionEnd,'end');input.dispatchEvent(new Event('input'));
  }
});
document.addEventListener('keydown',e=>{if(isLab&&(e.ctrlKey||e.metaKey)&&e.key==='Enter'&&e.target!==$('code-input')){e.preventDefault();runCode();}});
$('run-code').querySelector('kbd').textContent=/Mac|iPhone|iPad/.test(navigator.platform)?'⌘ ↵':'Ctrl ↵';
$('run-code').addEventListener('click',runCode);$('stop-code').addEventListener('click',()=>stopCode());
$('copy-code').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText($('code-input').value);toast('Python 代码已复制');}
  catch{$('code-input').focus();$('code-input').select();if(document.execCommand('copy'))toast('Python 代码已复制');else toast('请按 Ctrl / ⌘ + C 复制已选中的代码。');}
});
$('download-code').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([$('code-input').value],{type:'text/x-python;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`controller_${engine.n}dof.py`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('clear-console').addEventListener('click',()=>{logCount=0;$('console-count').textContent='0';$('console-output').innerHTML='<div class="console-empty"><svg class="icon"><use href="#i-terminal"/></svg><p>输出已清空。</p><span>等待下一条控制指令</span></div>';});
window.addEventListener('pagehide',()=>{saveCode();worker?.terminate();worker=null;runtimeReady=false;if(running)finishCode('离开页面，程序已停止');});

loadCode(storage.get(draftKey(engine.definition))??demo(engine.definition));updateConfig();rangePaint($('sim-speed'));route();requestAnimationFrame(animate);
