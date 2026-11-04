// Row-major homogeneous transforms. URDF: T(xyz) Rz(yaw) Ry(pitch) Rx(roll).
export function identity() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }

export function multiply(a,b) {
  const out = new Array(16).fill(0);
  for(let r=0;r<4;r++) for(let c=0;c<4;c++) for(let k=0;k<4;k++) out[r*4+c]+=a[r*4+k]*b[k*4+c];
  return out;
}

export function rotation(axis,q) {
  const length=Math.hypot(...axis),[x,y,z]=axis.map(v=>v/length);
  const c=Math.cos(q),s=Math.sin(q),t=1-c;
  return [t*x*x+c,t*x*y-s*z,t*x*z+s*y,0,
    t*x*y+s*z,t*y*y+c,t*y*z-s*x,0,
    t*x*z-s*y,t*y*z+s*x,t*z*z+c,0,0,0,0,1];
}

export function poseTransform({xyz=[0,0,0],rpy=[0,0,0]}={}) {
  const [r,p,y]=rpy;
  const out=multiply(multiply(rotation([0,0,1],y),rotation([0,1,0],p)),rotation([1,0,0],r));
  out[3]=xyz[0];out[7]=xyz[1];out[11]=xyz[2];return out;
}

export function standardDH({a,alpha,d,offset},q) {
  const c=Math.cos(q+offset),s=Math.sin(q+offset),ca=Math.cos(alpha),sa=Math.sin(alpha);
  // Rz(q + theta_offset) Tz(d) Tx(a) Rx(alpha)
  return [c,-s*ca,s*sa,a*c, s,c*ca,-c*sa,a*s, 0,sa,ca,d, 0,0,0,1];
}

export function position(frame) { return [frame[3],frame[7],frame[11]]; }
export function transformPoint(frame,p) {
  return [frame[0]*p[0]+frame[1]*p[1]+frame[2]*p[2]+frame[3],
    frame[4]*p[0]+frame[5]*p[1]+frame[6]*p[2]+frame[7],
    frame[8]*p[0]+frame[9]*p[1]+frame[10]*p[2]+frame[11]];
}
export function transformDirection(frame,p) {
  return [frame[0]*p[0]+frame[1]*p[1]+frame[2]*p[2],
    frame[4]*p[0]+frame[5]*p[1]+frame[6]*p[2],
    frame[8]*p[0]+frame[9]*p[1]+frame[10]*p[2]];
}

export function forwardChain(definition,q) {
  let frame=poseTransform(definition.base);
  const origins=[],axes=[],frames=[],centers=[],preFrames=[];
  for(let i=0;i<definition.joints.length;i++) {
    const joint=definition.joints[i];
    for(const prefix of joint.prefix||[])frame=multiply(frame,poseTransform(prefix));
    if(joint.kind==='urdf')frame=multiply(frame,poseTransform(joint.origin));
    const origin=position(frame);preFrames.push(frame);
    const sourceAxis=joint.kind==='dh'?[0,0,1]:joint.axis;
    origins.push(origin);axes.push(transformDirection(frame,sourceAxis.map(v=>v/Math.hypot(...sourceAxis))));
    frame=multiply(frame,joint.kind==='dh'?standardDH(joint,q[i]):rotation(joint.axis,q[i]));
    frames.push(frame);
    if(joint.kind==='urdf')centers.push(transformPoint(frame,joint.com));
    else centers.push(origin.map((x,k)=>(x+position(frame)[k])*.5));
  }
  for(const tool of definition.tool||[])frame=multiply(frame,poseTransform(tool));
  return {origins,axes,frames,centers,preFrames,tip:position(frame),tipFrame:frame};
}
