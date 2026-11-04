import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
const page=await context.newPage();
const errors=[],failed=[],remote=[];
page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failed.push(`${r.status()} ${r.url()}`);});
page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:5173'))remote.push(r.url());});
const artifacts=process.env.ARTIFACTS_DIR||'/tmp/yann-urdf-checks';await mkdir(artifacts,{recursive:true});
const source=readFileSync(new URL('./fixtures/custom-branches.urdf',import.meta.url),'utf8');
const neroSource=readFileSync(new URL('../assets/models/nero/NERO20251209URDF.urdf',import.meta.url),'utf8');
const oracle=JSON.parse(readFileSync(new URL('./fixtures/nero-fk.json',import.meta.url),'utf8'));
const step=message=>console.log(`✓ ${message}`);
const active=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('yann.lab.geometry.v1')));
const upload=async(text,name='custom.urdf')=>{
  if(!await page.locator('#urdf-dialog').isVisible())await page.locator('#upload-urdf').click();
  await page.locator('#urdf-file').setInputFiles({name,mimeType:'application/xml',buffer:Buffer.from(text)});
  await page.waitForFunction(()=>!document.getElementById('review-urdf').disabled||document.getElementById('urdf-import-error').textContent);
};
const apply=async()=>{
  await page.locator('#review-urdf').click();await page.waitForFunction(()=>document.getElementById('geometry-dialog').open);
  await page.locator('#apply-geometry').click();await page.waitForFunction(()=>!document.getElementById('geometry-dialog').open&&!document.getElementById('run-code').disabled);
};
const cancelImport=async()=>{await page.locator('#cancel-urdf').click();await page.waitForFunction(()=>!document.getElementById('urdf-dialog').open&&!document.getElementById('run-code').disabled);};
const run=async(code)=>{
  await page.locator('#clear-console').click();await page.locator('#code-input').fill(code);await page.locator('#run-code').click();
  await page.waitForFunction(()=>!document.getElementById('run-code').disabled,null,{timeout:45000});return page.locator('#console-output').innerText();
};

try {
  await page.goto(process.env.SITE_URL||'http://127.0.0.1:5173/#lab');await page.waitForFunction(()=>document.querySelector('#lab-scene canvas'));
  const parserResult=await page.evaluate(async({source,neroSource,oracle})=>{
    const {parseURDF,buildURDFDefinition}=await import('/assets/js/urdf-parser.js');
    const {ArmPhysics}=await import('/assets/js/physics.js');
    const {forwardChain,multiply,poseTransform}=await import('/assets/js/kinematics.js');
    const assert=(ok,message)=>{if(!ok)throw new Error(message);};
    const near=(a,b)=>assert(Math.abs(a-b)<1e-12,`${a} != ${b}`);
    const parsed=parseURDF(source),model=await buildURDFDefinition(parsed,'tool');
    assert(parsed.defaultTip==='tool','默认最长可用链');assert(model.joints.length===2,'仅导入选定链');
    assert(model.joints[0].motion==='prismatic'&&model.joints[1].continuous,'运动类型');
    assert(model.joints[0].axis[0]===2&&model.joints[1].axis[2]===3,'保留 source axis 原值');
    assert(model.extraBodies.length===1&&model.extraBodies[0].mass===1,'固定附件质量');
    assert(model.renderVisuals.length===3,'基本 visual');
    assert(model.renderVisuals[0].color[1]===.8,'命名 material');
    assert(model.renderVisuals[1].origin.rpy[2]===.3,'visual 原始变换');
    assert(model.joints[1].maxVelocity===2&&model.joints[1].maxTorque===30,'缺少驱动上限的明确替代');
    assert(model.uploadedURDF===source,'源文件精确保留');assert(model.sourceSHA256.length===64,'源文件 SHA256');
    const engine=new ArmPhysics(model);engine.q.set([.25,Math.PI/2]);engine.forward();
    const pose=engine.getNativePose();near(pose[0][3],.7);near(pose[1][3],.25);near(pose[2][3],1.3);
    near(pose[0][0],-1);near(pose[1][1],-1);near(pose[2][2],1);
    assert((await buildURDFDefinition(parsed,'other_arm')).joints.length===1,'可选其他分支');
    let rejected=false;try{await buildURDFDefinition(parsed,'finger');}catch(e){rejected=/mimic/.test(e.message);}assert(rejected,'mimic 显式拒绝');
    const invalid=[
      ['<robot><link name="a"></robot>',/解析失败/],
      ['<!DOCTYPE robot><robot/>',/DTD/],
      [source.replace('<link name="world"/>','<link name="world"/><link name="world"/>'),/重复/],
      [source.replace('child link="base"','child link="missing"'),/不存在/],
      [source.replace('parent link="world"','parent link="slider"'),/循环|不连通|根连杆/],
      [source.replace('xyz="2 0 0"','xyz="0 0 0"'),/axis.*零/],
      [source.replace('lower="0"','lower="${xacro}"'),/有限数值/],
      [source.replace('lower="0"','lower="0.9"'),/下限/],
      [source.replace(' upper="0.5"',''),/upper.*缺少/],
      [source.replace('mass value="2"','mass value="-2"'),/质量/],
      [source.replace('rpy="0.1 0.2 0.3"','rpy="0.1 0.2"'),/3 个值/],
    ];
    for(const [xml,expected] of invalid) {
      let message='';try{await buildURDFDefinition(parseURDF(xml),'tool');}catch(e){message=e.message;}
      assert(expected.test(message),`无效 URDF 未拒绝：${message}, ${expected}`);
    }
    const meshSource=source.replace('<box size="0.04 0.04 0.1"/>','<mesh filename="https://example.invalid/shape.stl"/>');
    const mesh=await buildURDFDefinition(parseURDF(meshSource),'tool');assert(mesh.notes.some(n=>n.includes('mesh')),'缺少 mesh 提示');
    const imported=await buildURDFDefinition(parseURDF(neroSource));
    const baseline=await (await fetch('/assets/models/nero/definition.json')).json();
    for(let i=0;i<7;i++)for(const key of ['origin','axis','lower','upper','mass','com','inertia'])assert(JSON.stringify(imported.joints[i][key])===JSON.stringify(baseline.joints[i][key]),`NERO 原始参数 ${i}.${key}`);
    const nengine=new ArmPhysics(imported);
    for(const sample of oracle.cases) {
      nengine.q.set(sample.q);nengine.forward();const actual=nengine.getNativePose();
      for(let r=0;r<4;r++)for(let c=0;c<4;c++)near(actual[r][c],sample.frame[r][c]);
    }
    // Visual transforms use the same anchors; no visual offset enters FK.
    const child=forwardChain(model,[.25,0]).frames[0];
    const visual=multiply(child,multiply(model.renderVisuals[1].attachment,poseTransform(model.renderVisuals[1].origin)));
    assert(visual.every(Number.isFinite),'visual anchor 变换');
    return {invalid:invalid.length,nero:oracle.cases.length};
  },{source,neroSource,oracle});
  step(`真实浏览器 XML 解析：分支/固定变换/visual/惯量，${parserResult.invalid} 类无效输入，NERO ${parserResult.nero} 组 FK 保留`);

  const original=await page.locator('#api-dof').innerText();
  await page.route('**/assets/models/nero/definition.json',async route=>{await new Promise(resolve=>setTimeout(resolve,500));await route.continue();});
  await page.locator('#model-preset').selectOption('nero7');await page.locator('#upload-urdf').click();
  await page.waitForTimeout(700);assert.equal(await page.locator('#api-dof').innerText(),original);
  await page.unroute('**/assets/models/nero/definition.json');await cancelImport();step('打开导入窗口会取消尚未完成的预设加载');
  await upload('<robot><link name="a"></robot>','broken.urdf');assert.match(await page.locator('#urdf-import-error').innerText(),/解析失败/);
  assert.equal(await page.locator('#review-urdf').isEnabled(),false);assert.equal(await page.locator('#api-dof').innerText(),original);
  await upload(source);assert.equal(await page.locator('#urdf-model-summary').innerText(),'2 轴 · 1 旋转（含 1 连续）· 1 直线');
  assert.equal(await page.locator('#urdf-chain option[value="finger"]').isDisabled(),true);
  await page.locator('#urdf-chain').selectOption('other_arm');await page.waitForFunction(()=>document.getElementById('urdf-model-summary').textContent.startsWith('1 轴'));
  await page.locator('#urdf-chain').selectOption('tool');await page.waitForFunction(()=>document.getElementById('urdf-model-summary').textContent.startsWith('2 轴'));
  await page.screenshot({path:`${artifacts}/import-desktop.png`,fullPage:true});
  await page.locator('#review-urdf').click();await page.waitForFunction(()=>document.getElementById('geometry-dialog').open);
  assert.equal(await page.locator('#geometry-rows input[data-joint="0"][data-field="upper"]').inputValue(),'0.5');
  assert.match(await page.locator('#geometry-summary').innerText(),/直线关节.*m\/s/);
  await page.locator('#cancel-geometry').click();await page.waitForFunction(()=>!document.getElementById('geometry-dialog').open&&!document.getElementById('run-code').disabled);
  assert.equal(await page.locator('#api-dof').innerText(),original);step('无效文件可重试、分支选择、取消检查保留当前构型');

  await upload(source);await apply();const model=await active();assert.equal(model.label,'Precision & Motion');assert.equal(model.joints.length,2);
  assert.equal(await page.locator('#joint-units').innerText(),'DEG / MM');assert.equal(await page.locator('#joint-0').getAttribute('max'),'500');
  assert.match(await page.locator('#code-input').inputValue(),/linear_joints = \[0\]/);
  await page.locator('#joint-0').fill('100');await page.locator('#joint-0').dispatchEvent('input');await page.waitForTimeout(1000);
  assert.ok(Number((await page.locator('#joint-value-0').innerText()).replace('mm',''))>10);
  await page.locator('#reset-arm').click();
  const output=await run('from arm import Robot\nimport math, json\nr = Robot(dof=2)\nassert r.get_geometry()["joints"][0]["motion"] == "prismatic"\nassert math.isinf(r.get_joint_limits()[1][1])\nawait r.move_joints([0.1, math.pi * 4], duration=8)\nq = r.get_joint_positions()\nassert abs(q[0] - 0.1) < 0.002, q\nassert q[1] > math.pi * 3, q\nprint("JOINTS " + json.dumps(q))\nprint("POSE " + json.dumps(r.get_end_effector_pose()))');
  assert.match(output,/程序运行完成/);assert.doesNotMatch(output,/Traceback/);
  const q=JSON.parse(output.match(/JOINTS (\[.*\])/)[1]),pose=JSON.parse(output.match(/POSE (\[.*\])/)[1]);
  const expected=await page.evaluate(async q=>{const {ArmPhysics}=await import('/assets/js/physics.js');const e=new ArmPhysics(JSON.parse(localStorage.getItem('yann.lab.geometry.v1')));e.q.set(q);e.forward();return e.getNativePose();},q);
  for(let r=0;r<4;r++)for(let c=0;c<4;c++)assert.ok(Math.abs(pose[r][c]-expected[r][c])<1e-10);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#lab-scene canvas'));assert.equal((await active()).uploadedURDF,source);
  step('自定义 URDF 控制、mm 滑块、Python 直线/多圈运动、完整位姿和刷新保存');

  await page.locator('#edit-geometry').click();await page.locator('#urdf-reference summary').click();
  const downloadWait=page.waitForEvent('download');await page.locator('#download-urdf-source').click();const download=await downloadWait;
  assert.equal(readFileSync(await download.path(),'utf8'),source);
  await page.locator('#cancel-geometry').click();await page.waitForFunction(()=>!document.getElementById('geometry-dialog').open);
  await upload('x'.repeat(5*1024*1024+1),'large.urdf');assert.match(await page.locator('#urdf-import-error').innerText(),/5 MB/);await cancelImport();
  const hostile=source.replace('Precision &amp; Motion','&lt;img src=x onerror=alert(1)&gt;');await upload(hostile);
  assert.equal(await page.locator('#urdf-model-name img').count(),0);assert.match(await page.locator('#urdf-model-name').innerText(),/<img/);await cancelImport();
  step('源 URDF 下载精确保留、文件大小限制、模型名称按文本显示');

  await page.locator('#model-preset').selectOption('nero7');await page.waitForFunction(()=>document.getElementById('model-preset').value==='nero7'&&!document.getElementById('run-code').disabled);
  const baseline=await active();await page.locator('#reset-camera').click();await page.locator('#toggle-grid').click();await page.locator('#toggle-grid').click();await page.locator('#reset-arm').click();
  assert.deepEqual((await active()).joints,baseline.joints);await page.waitForTimeout(300);
  await page.locator('.simulator').screenshot({path:`${artifacts}/nero-desktop.png`});
  await upload(neroSource,'NERO20251209URDF.urdf');await apply();assert.deepEqual((await active()).joints.map(j=>j.origin),baseline.joints.map(j=>j.origin));
  const saved=await active();await page.locator('#load-demo').click();
  const demo=await page.locator('#code-input').inputValue();assert.match(await run(demo),/运动完成/);
  assert.deepEqual((await active()).joints,saved.joints);step('NERO 新外壳与相机操作不改参数，原 URDF 上传及 Demo 可运行');

  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${artifacts}/nero-mobile.png`,fullPage:true});
  await upload(source);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${artifacts}/import-mobile.png`,fullPage:true});
  await page.locator('#review-urdf').click();await page.waitForFunction(()=>document.getElementById('geometry-dialog').open);
  const rect=await page.locator('#apply-geometry').boundingBox();assert.ok(rect.y+rect.height<=844);
  await page.screenshot({path:`${artifacts}/geometry-mobile.png`,fullPage:true});await page.locator('#cancel-geometry').click();
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert.deepEqual(remote,[]);
  console.log(`URDF 浏览器检查全部通过。截图：${artifacts}`);
} catch(error) {
  console.log('解析错误:',await page.locator('#urdf-import-error').textContent());
  console.log('构型错误:',await page.locator('#geometry-error').textContent());
  console.log('运行输出:',await page.locator('#console-output').innerText());
  await page.screenshot({path:`${artifacts}/failure.png`,fullPage:true});throw error;
} finally {await browser.close();}
