import { createGeneric, validateDefinition } from './models.js';
import { forwardChain, poseTransform, position, multiply, transformPoint } from './kinematics.js';
export { validateDOF, MEMORY_BUDGET } from './models.js';
export const DT = 1 / 120;
export const RENDER_LIMIT = 128;
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));

export class ArmPhysics {
  constructor(model = 6) {
    this.definition=structuredClone(validateDefinition(typeof model==='number'?createGeneric(model):model));
    this.n=this.definition.joints.length;
    this.q=Float64Array.from(this.definition.joints,j=>j.q0);
    this.dq=new Float64Array(this.n);
    this.target=this.q.slice();this.velocity=new Float64Array(this.n);this.torque=new Float64Array(this.n);
    this.inertia=new Float64Array(this.n);this.lengths=new Float64Array(this.n);
    this.points=new Float64Array((this.n+1)*3);this.axes=new Float64Array(this.n*3);
    this.centers=new Float64Array(this.n*3);this.gravityTorque=new Float64Array(this.n);
    this.masses=new Float64Array(this.n);
    this.mode='position';this.gravity=true;this.time=0;this.contacts=0;
    this.forward();this.estimateInertia();
  }

  estimateInertia() {
    // Diagonal approximation from source masses/COM and joint-axis projection.
    // Backward mass moments avoid O(N²) storage or work.
    let mass=0;const sum=[0,0,0],second=[0,0,0,0,0,0];
    for(let i=this.n-1;i>=0;i--) {
      const joint=this.definition.joints[i],m=this.masses[i],k=i*3;
      const c=Array.from(this.centers.slice(k,k+3)),o=Array.from(this.points.slice(k,k+3)),a=Array.from(this.axes.slice(k,k+3));
      mass+=m;for(let d=0;d<3;d++)sum[d]+=m*c[d];
      second[0]+=m*c[0]*c[0];second[1]+=m*c[1]*c[1];second[2]+=m*c[2]*c[2];
      second[3]+=m*c[0]*c[1];second[4]+=m*c[0]*c[2];second[5]+=m*c[1]*c[2];
      const trace=second[0]+second[1]+second[2]-2*o.reduce((v,x,d)=>v+x*sum[d],0)+mass*o.reduce((v,x)=>v+x*x,0);
      const ao=a.reduce((v,x,d)=>v+x*o[d],0),as=a.reduce((v,x,d)=>v+x*sum[d],0);
      const axial=a[0]*a[0]*second[0]+a[1]*a[1]*second[1]+a[2]*a[2]*second[2]+2*(a[0]*a[1]*second[3]+a[0]*a[2]*second[4]+a[1]*a[2]*second[5])-2*ao*as+mass*ao*ao;
      let local=.004;
      if(joint.inertia&&joint.motion!=='prismatic') {
        const inv=poseTransform({rpy:(joint.inertialRPY||[0,0,0]),xyz:[0,0,0]});
        // Rotate the source joint axis into the inertial frame (R transpose).
        const axis=joint.axis.map(v=>v/Math.hypot(...joint.axis)),[x,y,z]=[inv[0]*axis[0]+inv[4]*axis[1]+inv[8]*axis[2],inv[1]*axis[0]+inv[5]*axis[1]+inv[9]*axis[2],inv[2]*axis[0]+inv[6]*axis[1]+inv[10]*axis[2]];
        const I=joint.inertia;local=x*x*I.ixx+y*y*I.iyy+z*z*I.izz+2*(x*y*I.ixy+x*z*I.ixz+y*z*I.iyz);
      }
      this.inertia[i]=joint.motion==='prismatic'?Math.max(.01,mass):Math.max(.003,trace-axial+local);
    }
  }

  validate(values,mode) {
    const arr=Array.from(values);
    if(arr.length!==this.n)throw new Error(`需要 ${this.n} 个关节值，收到 ${arr.length} 个。`);
    if(!arr.every(x=>typeof x==='number'&&Number.isFinite(x)))throw new Error('所有关节值必须是有限数值。');
    arr.forEach((x,i)=>{
      const joint=this.definition.joints[i];
      const linear=joint.motion==='prismatic';
      if(mode==='position'&&!joint.continuous&&(x<joint.lower||x>joint.upper))throw new Error(`J${i+1} ${linear?'关节位移':'关节角度'}须位于 [${joint.lower.toFixed(4)}, ${joint.upper.toFixed(4)}] ${linear?'m':'rad'} 内。`);
      if(mode==='velocity'&&Math.abs(x)>joint.maxVelocity)throw new Error(`J${i+1} 目标${linear?'速度':'角速度'}须位于 [-${joint.maxVelocity}, ${joint.maxVelocity}] ${linear?'m/s':'rad/s'} 内。`);
      if(mode==='torque'&&Math.abs(x)>joint.maxTorque)throw new Error(`J${i+1} 关节${linear?'力':'力矩'}须位于 [-${joint.maxTorque}, ${joint.maxTorque}] ${linear?'N':'N·m'} 内。`);
    });
    return arr;
  }

  set(values,mode) {
    if(!['position','velocity','torque'].includes(mode))throw new Error('未知控制模式。');
    const arr=this.validate(values,mode);this.mode=mode;
    (mode==='position'?this.target:mode==='velocity'?this.velocity:this.torque).set(arr);
  }

  forward() {
    this.chain=forwardChain(this.definition,this.q);
    for(let i=0;i<this.n;i++) {
      const k=i*3;this.points.set(this.chain.origins[i],k);this.axes.set(this.chain.axes[i],k);this.centers.set(this.chain.centers[i],k);
      this.masses[i]=this.definition.joints[i].mass;
      const next=i+1<this.n?this.chain.origins[i+1]:this.chain.tip;
      this.lengths[i]=Math.hypot(...next.map((x,d)=>x-this.chain.origins[i][d]));
    }
    this.points.set(this.chain.tip,this.n*3);
    for(const body of this.definition.extraBodies||[]) {
      const i=body.anchor,k=i*3,center=transformPoint(multiply(this.chain.frames[i],body.attachment),body.com),total=this.masses[i]+body.mass;
      if(total>0)for(let d=0;d<3;d++)this.centers[k+d]=(this.centers[k+d]*this.masses[i]+center[d]*body.mass)/total;
      this.masses[i]=total;
    }
    let sumX=0,sumZ=0,mass=0;
    for(let i=this.n-1;i>=0;i--) {
      const k=i*3,m=this.masses[i];mass+=m;sumX+=m*this.centers[k];sumZ+=m*this.centers[k+2];
      const rx=sumX-mass*this.points[k],rz=sumZ-mass*this.points[k+2];
      this.gravityTorque[i]=this.gravity?(this.definition.joints[i].motion==='prismatic'?-9.81*mass*this.axes[k+1]:9.81*(rz*this.axes[k]-rx*this.axes[k+2])):0;
    }
    return this.points;
  }

  getNativeTip() {
    const frame=poseTransform(this.definition.base),p=this.chain.tip;
    const delta=p.map((x,d)=>x-position(frame)[d]);
    return [frame[0]*delta[0]+frame[4]*delta[1]+frame[8]*delta[2],frame[1]*delta[0]+frame[5]*delta[1]+frame[9]*delta[2],frame[2]*delta[0]+frame[6]*delta[1]+frame[10]*delta[2]];
  }

  getNativePose() {
    const f=poseTransform(this.definition.base);
    const inverse=[f[0],f[4],f[8],0,f[1],f[5],f[9],0,f[2],f[6],f[10],0,0,0,0,1];
    for(let r=0;r<3;r++)inverse[r*4+3]=-(inverse[r*4]*f[3]+inverse[r*4+1]*f[7]+inverse[r*4+2]*f[11]);
    const out=multiply(inverse,this.chain.tipFrame);
    return Array.from({length:4},(_,r)=>out.slice(r*4,r*4+4));
  }

  step(dt=DT) {
    if(!Number.isFinite(dt)||dt<=0||dt>.1)throw new Error('dt 必须位于 (0, 0.1] 秒内。');
    const substeps=Math.ceil(dt/DT),h=dt/substeps;
    for(let s=0;s<substeps;s++) {
      this.forward();const before=this.q.slice();
      for(let i=0;i<this.n;i++) {
        const joint=this.definition.joints[i],inertia=this.inertia[i];let command=this.torque[i];
        if(this.mode==='position')command=inertia*(95*(this.target[i]-this.q[i])-19*this.dq[i])-this.gravityTorque[i];
        if(this.mode==='velocity')command=inertia*18*(this.velocity[i]-this.dq[i])-this.gravityTorque[i];
        const accel=(clamp(command,-joint.maxTorque,joint.maxTorque)+this.gravityTorque[i]-.04*this.dq[i])/inertia;
        this.dq[i]=clamp(this.dq[i]+accel*h,-joint.maxVelocity,joint.maxVelocity);this.q[i]+=this.dq[i]*h;
        if(!joint.continuous&&(this.q[i]<joint.lower||this.q[i]>joint.upper)){this.q[i]=clamp(this.q[i],joint.lower,joint.upper);this.dq[i]=0;}
      }
      this.forward();
      let contact=false;
      for(let i=0;i<=this.n;i++)if(this.points[i*3+1]<.025){contact=true;break;}
      if(contact){this.q.set(before);this.dq.fill(0);this.contacts++;this.forward();}
      this.time+=h;
    }
  }

  snapshot() {
    return {q:Array.from(this.q),dq:Array.from(this.dq),target:Array.from(this.target),velocity:Array.from(this.velocity),torque:Array.from(this.torque),mode:this.mode,time:this.time,contacts:this.contacts};
  }

  restore(state) {
    this.q.set(state.q);this.dq.set(state.dq);
    if(state.target)this.target.set(state.target);if(state.velocity)this.velocity.set(state.velocity);if(state.torque)this.torque.set(state.torque);
    this.mode=state.mode;this.time=state.time;this.contacts=state.contacts||0;this.forward();
  }
}
