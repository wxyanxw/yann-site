import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[],failed=[];
page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failed.push(r.url());});
const artifacts=process.env.ARTIFACTS_DIR||'/tmp/yann-geometry-checks';await mkdir(artifacts,{recursive:true});
const step=message=>console.log(`✓ ${message}`);
const field=(joint,name)=>page.locator(`#geometry-rows input[data-joint="${joint}"][data-field="${name}"]`);
const run=async(code)=>{await page.locator('#code-input').fill(code);await page.locator('#run-code').click();await page.waitForFunction(()=>!document.getElementById('run-code').disabled,null,{timeout:45000});return page.locator('#console-output').innerText();};
const selectPreset=async id=>{await page.locator('#model-preset').selectOption(id);await page.waitForFunction(value=>document.getElementById('model-preset').value===value&&document.getElementById('model-source').textContent.indexOf('正在加载')===-1&&document.getElementById('run-code').disabled===false,id,{timeout:10000});};
const active=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('yann.lab.geometry.v1')));
const within=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);

try {
  await page.goto(process.env.SITE_URL||'http://127.0.0.1:5173/#lab');
  await page.waitForFunction(()=>document.querySelector('#lab-scene canvas'));
  await selectPreset('industrial6');const six=await active();
  await page.locator('#axis-plus').click();
  assert.equal(await page.locator('#geometry-dialog').isVisible(),true);assert.equal(await field(6,'a').inputValue(),'');
  await page.locator('#apply-geometry').click();assert.match(await page.locator('#geometry-error').innerText(),/J7.*尚未定义/);
  assert.equal(await page.locator('#api-dof').innerText(),'6');assert.equal(await page.locator('#run-code').isEnabled(),false);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.getElementById('geometry-dialog').open&&!document.getElementById('run-code').disabled);assert.equal(await page.locator('#axis-count').inputValue(),'6');assert.equal(await page.locator('#run-code').isEnabled(),true);
  step('新增轴进入空白 DH 编辑，未定义无法应用，取消保持原六轴');

  await page.locator('#axis-plus').click();
  await field(6,'a').fill('.2');await field(6,'alpha').fill('90');await field(6,'d').fill('.04');await field(6,'offset').fill('15');
  await page.locator('#apply-geometry').click();
  await page.waitForFunction(()=>!document.getElementById('geometry-dialog').open&&document.getElementById('api-dof').textContent==='7');
  assert.equal(await page.locator('#geometry-dialog').isVisible(),false);
  const seven=await active();assert.deepEqual(seven.joints.slice(0,6),six.joints);within(seven.joints[6].alpha,Math.PI/2);within(seven.joints[6].offset,Math.PI/12);
  const result=await run('from arm import Robot\nimport json\nr = Robot(dof=7)\nprint("DH " + json.dumps(r.get_geometry()["joints"][6]))\nprint("POSE " + json.dumps(r.get_end_effector_pose()))');
  assert.match(result,/"a": 0.2/);assert.match(result,/"d": 0.04/);
  const pose=JSON.parse(result.match(/POSE (\[.*\])/)[1]);
  const expected=await page.evaluate(async()=>{const {ArmPhysics}=await import('/assets/js/physics.js');return new ArmPhysics(JSON.parse(localStorage.getItem('yann.lab.geometry.v1'))).getNativePose();});
  for(let r=0;r<4;r++)for(let c=0;c<4;c++)within(pose[r][c],expected[r][c]);
  step('新 DH 参数实际进入运动学与 Python，原六轴参数无缩放或覆盖');

  await page.locator('#reset-arm').click();assert.deepEqual((await active()).joints,seven.joints);
  await page.locator('#edit-geometry').click();await page.locator('#geometry-next').click();assert.equal(await field(6,'a').inputValue(),'0.2');
  await field(6,'lower').fill('180');await field(6,'upper').fill('-180');await page.locator('#apply-geometry').click();assert.match(await page.locator('#geometry-error').innerText(),/下限必须小于上限/);
  await page.locator('#cancel-geometry').click();
  await page.reload();await page.waitForFunction(()=>document.querySelector('#lab-scene canvas'));assert.equal(await page.locator('#api-dof').innerText(),'7');assert.equal((await active()).joints[6].a,.2);
  step('构型重置/刷新保留，关节限位校验，取消编辑不改模型');

  await selectPreset('nero7');const nero=await active();
  assert.equal(nero.joints.length,7);assert.equal(nero.joints[5].upper,.95);assert.equal(await page.locator('#viewport-model-label').innerText(),'NERO / PRECISION SHELL');
  within(Number(await page.locator('#joint-5').getAttribute('max')),.95*180/Math.PI);
  await page.locator('#edit-geometry').click();
  assert.match(await page.locator('#geometry-summary').innerText(),/2 rad\/s、30 N·m/);
  assert.match(await page.locator('#geometry-summary').innerText(),/未提供.*STL/);
  assert.equal(await field(0,'a').count(),0);assert.equal(await field(3,'lower').isDisabled(),true);
  await page.locator('#urdf-reference summary').click();assert.match(await page.locator('#urdf-rows').innerText(),/1.5708 3.1415 0/);
  await page.screenshot({path:`${artifacts}/nero-parameters.png`,fullPage:true});
  await page.locator('#cancel-geometry').click();
  const raw=await run('from arm import Robot\nimport json\nr = Robot(dof=7)\nprint("NERO_POSE " + json.dumps(r.get_end_effector_pose()))\nprint("NERO_LIMITS " + json.dumps(r.get_joint_limits()))');
  const native=JSON.parse(raw.match(/NERO_POSE (\[.*\])/)[1]);
  const oracle=JSON.parse(readFileSync(new URL('./fixtures/nero-fk.json',import.meta.url))).cases[0].frame;
  for(let r=0;r<4;r++)for(let c=0;c<4;c++)within(native[r][c],oracle[r][c]);
  assert.match(raw,/\[-0.73, 0.95\]/);
  const invalid=await run('from arm import Robot\nr = Robot(dof=7)\nq = r.get_joint_positions()\nq[5] = 1.0\nr.set_joint_positions(q)');assert.match(invalid,/J6.*0.9500/);
  await page.locator('#load-demo').click();await page.locator('#run-code').click();await page.waitForFunction(()=>!document.getElementById('run-code').disabled,null,{timeout:20000});
  assert.match(await page.locator('#console-output').innerText(),/运动完成/);
  step('NERO 原生 URDF/限位与 Python 完整位姿一致，七轴 Demo 可运行');

  await page.locator('#axis-plus').click();assert.equal(await field(6,'a').count(),0);assert.equal(await field(7,'a').inputValue(),'');
  await field(7,'a').fill('.12');await field(7,'alpha').fill('0');await field(7,'d').fill('.02');await field(7,'offset').fill('0');
  await page.locator('#apply-geometry').click();
  await page.waitForFunction(()=>!document.getElementById('geometry-dialog').open&&document.getElementById('api-dof').textContent==='8');
  const extended=await active();assert.deepEqual(extended.joints.slice(0,7),nero.joints);assert.equal(extended.joints[7].kind,'dh');
  await selectPreset('planar3');
  await page.locator('#model-preset').selectOption('custom');
  await page.locator('#apply-geometry').click();
  await page.waitForFunction(()=>!document.getElementById('geometry-dialog').open&&document.getElementById('api-dof').textContent==='8');
  assert.deepEqual((await active()).joints,extended.joints);
  await page.locator('#edit-geometry').click();await page.locator('#geometry-next').click();
  await page.screenshot({path:`${artifacts}/nero-extension-dh.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`${artifacts}/dh-mobile.png`,fullPage:true});await page.locator('#cancel-geometry').click();
  await page.screenshot({path:`${artifacts}/nero-mobile.png`,fullPage:true});
  step('NERO 扩展第八轴采用 DH，前七轴精确保留，手机参数表可滚动');
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);console.log(`构型浏览器检查全部通过。截图：${artifacts}`);
} catch(error) {
  console.log('构型错误:',await page.locator('#geometry-error').textContent());
  console.log('当前轴数:',await page.locator('#axis-count').inputValue());
  console.log('编辑字段:',await page.locator('#geometry-rows input').evaluateAll(inputs=>inputs.map(i=>({joint:i.dataset.joint,field:i.dataset.field,value:i.value}))));
  await page.screenshot({path:`${artifacts}/failure.png`,fullPage:true});throw error;
} finally {await browser.close();}
