import { loadPyodide } from '../vendor/pyodide/pyodide.mjs';
import { ArmPhysics } from './physics.js';

let pyodide, engine, paused = false, speed = 1, lastPublish = 0, wallStart = 0, simStart = 0;
let pauseStart = 0;
let outputWindow = 0, outputCount = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
const asArray = x => x?.toJs ? x.toJs() : Array.from(x);

function output(type,text) {
  if(performance.now()-outputWindow>1000){outputWindow=performance.now();outputCount=0;}
  outputCount++;
  if(outputCount<=100)postMessage({type,text:String(text).slice(0,6000)});
  else if(outputCount===101)postMessage({type:'stderr',text:'输出过于频繁，已限制为每秒 100 行。'});
}

async function checkpoint(dt) {
  while (paused) await delay(35);
  engine.step(dt);
  // Pace against simulation time. Browser execution stays responsive between steps.
  const deadline = wallStart + (engine.time - simStart) * 1000 / speed;
  if (performance.now() - lastPublish > 30) {
    postMessage({type:'frame',state:engine.snapshot()}); lastPublish = performance.now();
  }
  await delay(Math.min(100,Math.max(0,deadline - performance.now())));
}

self.onmessage = async ({data}) => {
  if (data.type === 'pause') {
    if (data.paused && !paused) pauseStart = performance.now();
    if (!data.paused && paused) wallStart += performance.now() - pauseStart;
    paused = data.paused; return;
  }
  if (data.type === 'settings') {
    if (engine) engine.gravity = data.gravity;
    if (engine) { wallStart = performance.now(); simStart = engine.time; }
    speed = data.speed; return;
  }
  if (data.type !== 'run') return;
  try {
    if (!pyodide) {
      postMessage({type:'loading',message:'正在启动本地 Python 运行时…'});
      pyodide = await loadPyodide({indexURL:new URL('../vendor/pyodide/',import.meta.url).href,
        stdout:text=>output('stdout',text),stderr:text=>output('stderr',text)});
    }
    engine = new ArmPhysics(data.definition); engine.restore(data.state); engine.gravity=data.gravity; speed=data.speed; paused=false;
    self.armGet = kind => Array.from(kind === 'velocity' ? engine.dq : engine.q);
    self.armSet = (values,kind) => engine.set(asArray(values),kind);
    self.armValidate = values => engine.validate(asArray(values),'position');
    self.armStep = checkpoint;
    self.armTime = () => engine.time;
    self.armDOF = data.dof;
    self.armLimits = () => engine.definition.joints.map(j=>j.continuous?[-Infinity,Infinity]:[j.lower,j.upper]);
    self.armGeometry = JSON.stringify(engine.definition);
    self.armPose = () => engine.getNativePose();
    await pyodide.runPythonAsync(`
import sys, types, math, asyncio, json
from js import armGet, armSet, armStep, armTime, armDOF, armValidate, armLimits, armGeometry, armPose

class Robot:
    def __init__(self, dof=None):
        self.dof = int(armDOF)
        if dof is not None and (isinstance(dof, bool) or not isinstance(dof, int) or dof != self.dof):
            raise ValueError(f"Robot(dof={dof}) 与当前 {self.dof} 轴模型不一致，请调整配置或代码。")
    def get_joint_positions(self):
        return list(armGet('position').to_py())
    def get_joint_velocities(self):
        return list(armGet('velocity').to_py())
    def get_joint_limits(self):
        return armLimits().to_py()
    def get_geometry(self):
        return json.loads(str(armGeometry))
    def get_end_effector_pose(self):
        return armPose().to_py()
    def set_joint_positions(self, q):
        armSet(list(q), 'position')
    def set_joint_velocities(self, dq):
        armSet(list(dq), 'velocity')
    def set_joint_torques(self, tau):
        armSet(list(tau), 'torque')
    @property
    def time(self):
        return float(armTime())
    async def step(self, dt=1/120):
        await armStep(float(dt))
    async def move_joints(self, q, duration=1.5):
        target = list(q)
        armValidate(target)
        if not math.isfinite(duration) or not 0 < duration <= 60:
            raise ValueError('duration 必须位于 (0, 60] 秒内')
        start = self.get_joint_positions()
        steps = math.ceil(duration * 120)
        for k in range(1, steps + 1):
            u = k / steps
            smooth = u * u * (3 - 2*u)
            self.set_joint_positions([a + (b-a)*smooth for a,b in zip(start,target)])
            await self.step(duration/steps)
        self.set_joint_positions(target)
        for _ in range(48):
            await self.step()

arm_module = types.ModuleType('arm')
arm_module.Robot = Robot
sys.modules['arm'] = arm_module
`);
    postMessage({type:'ready',version:pyodide.runPython('sys.version.split()[0]')});
    wallStart=performance.now(); simStart=engine.time; lastPublish=0;
    const globals = pyodide.toPy({__name__:'__main__'});
    try { await pyodide.runPythonAsync(data.code,{globals,filename:'controller.py'}); }
    finally { globals.destroy(); }
    postMessage({type:'done',state:engine.snapshot()});
  } catch (error) {
    postMessage({type:'error',message:String(error),state:engine?.snapshot()});
  }
};
