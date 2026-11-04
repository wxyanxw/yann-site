import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const context = await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,acceptDownloads:true});
const page = await context.newPage();
const errors=[],failedRequests=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('response',res=>{if(res.status()>=400)failedRequests.push(`${res.status()} ${res.url()}`);});
const artifacts=process.env.ARTIFACTS_DIR || '/tmp/yann-site-checks';
await mkdir(artifacts,{recursive:true});
const step=name=>console.log(`✓ ${name}`);
const selectAxes=async n=>{await page.locator('#axis-count').fill(String(n));await page.locator('#axis-count').dispatchEvent('change');};
const code=async text=>{await page.locator('#code-input').fill(text);};
const run=async()=>{
  await page.locator('#run-code').click();
  await page.waitForFunction(()=>!document.getElementById('run-code').disabled,null,{timeout:45000});
  return page.locator('#console-output').innerText();
};
const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'页面不能出现横向溢出');

try {
  await page.goto(process.env.SITE_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(()=>document.querySelector('#hero-scene canvas'));
  await page.waitForTimeout(500);
  await page.screenshot({path:`${artifacts}/home-desktop.png`,fullPage:true});
  await page.locator('.destination-card[data-placeholder="博客"]').click();
  assert.match(await page.locator('#toast').textContent(),/博客正在准备/);
  step('首页三维模型、四个入口与预留状态');

  await page.locator('.hero-actions a').click();
  await page.waitForFunction(()=>document.querySelector('#lab-scene canvas'));
  await page.screenshot({path:`${artifacts}/lab-desktop.png`,fullPage:true});
  assert.equal(await page.locator('#api-model').textContent(),'Robot(dof=6)');
  const output=await run();
  assert.match(output,/Python 3.12.7/);assert.match(output,/运动完成 · 仿真时间 4.80 s/);assert.match(output,/程序运行完成/);
  step('本地 Python 3.12.7 完整执行六轴运动 Demo');

  await selectAxes(1);assert.equal(await page.locator('#joint-controls input').count(),1);
  assert.match(await run(),/已连接 1 轴机械臂/);
  await selectAxes(3);assert.equal(await page.locator('#joint-controls input').count(),3);
  await page.locator('#joint-0').fill('45');await page.locator('#joint-0').dispatchEvent('input');
  await page.waitForTimeout(750);
  assert.ok(Number((await page.locator('#joint-value-0').innerText()).replace('°',''))>0);
  step('一轴 Python Demo 与三轴滑块实际控制');

  await page.locator('#gravity-toggle').uncheck();
  await code('from arm import Robot\nrobot = Robot(dof=3)\nrobot.set_joint_velocities([0.2, 0.0, 0.0])\nfor _ in range(30):\n    await robot.step()\nprint("velocity", robot.get_joint_velocities())\nrobot.set_joint_torques([0.0, 0.0, 0.0])\nawait robot.step()\nprint("torque", robot.time)');
  const velocity=await run();assert.match(velocity,/velocity \[/);assert.match(velocity,/torque /);
  assert.equal(await page.locator('#control-mode').innerText(),'力矩控制');
  await code('from arm import Robot\nrobot = Robot(dof=3)\nrobot.set_joint_positions([0])');
  assert.match(await run(),/需要 3 个关节值/);
  step('速度和力矩接口运行、输入长度错误反馈');

  await selectAxes(129);assert.equal(await page.locator('#api-dof').innerText(),'129');
  await page.locator('#joint-next').click();assert.match(await page.locator('#joint-page-label').innerText(),/7–12 \/ 129/);
  for(const invalid of ['0','1.5','1000000']) {
    await page.locator('#axis-count').fill(invalid);await page.locator('#axis-count').dispatchEvent('change');
    assert.equal(await page.locator('#axis-count').inputValue(),'129');
  }
  step('129 轴接口、分页和非法轴数/内存预算防护');

  await selectAxes(6);await page.locator('#load-demo').click();
  await page.locator('#run-code').click();
  await page.waitForFunction(()=>Number(document.getElementById('sim-time').textContent.replace('s',''))>.3);
  await page.locator('#pause-sim').click();await page.waitForTimeout(350);
  const paused=await page.locator('#sim-time').innerText();await page.waitForTimeout(400);
  assert.equal(await page.locator('#sim-time').innerText(),paused);
  await page.locator('#pause-sim').click();await page.waitForTimeout(300);
  await page.locator('#stop-code').click();assert.equal(await page.locator('#stop-code').isVisible(),false);
  step('暂停保持仿真时间、恢复运行和终止 Worker');

  await code('while True:\n    pass');await page.locator('#run-code').click();
  await page.waitForFunction(()=>document.getElementById('python-status').textContent.includes('本地运行'),null,{timeout:30000});
  await page.waitForTimeout(500);await page.locator('#stop-code').click();
  assert.equal(await page.locator('#run-code').isEnabled(),true);
  step('Python 无限循环可终止，主界面保持响应');

  const draft='# 草稿保留验证\nprint("saved")';await code(draft);await page.waitForTimeout(550);
  await selectAxes(7);await selectAxes(6);assert.equal(await page.locator('#code-input').inputValue(),draft);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#lab-scene canvas'));
  assert.equal(await page.locator('#code-input').inputValue(),draft);
  const downloadPromise=page.waitForEvent('download');await page.locator('#download-code').click();
  const download=await downloadPromise;assert.equal(download.suggestedFilename(),'controller_6dof.py');
  await page.locator('#load-demo').click();
  step('按轴数保留草稿、刷新恢复与 Python 文件下载');

  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);await noOverflow();
  await page.screenshot({path:`${artifacts}/lab-mobile.png`,fullPage:true});
  assert.equal(await page.locator('#load-demo').isVisible(),true);
  await page.locator('a.brand').click();await page.waitForTimeout(400);await noOverflow();
  await page.screenshot({path:`${artifacts}/home-mobile.png`,fullPage:true});
  await page.setViewportSize({width:768,height:1024});await page.waitForTimeout(200);await noOverflow();
  step('390 px 手机和 768 px 平板布局，无水平溢出');

  assert.deepEqual(errors,[]);assert.deepEqual(failedRequests,[]);
  console.log(`全部浏览器检查通过。截图：${artifacts}`);
} finally { await browser.close(); }
