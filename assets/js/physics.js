export const DT = 1 / 120;
export const RENDER_LIMIT = 128;
export const MEMORY_BUDGET = 32 * 1024 * 1024;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function validateDOF(n) {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('轴数必须是大于或等于 1 的整数。');
  // Includes engine, snapshots and Python/JS bridge allocations. Reject before allocation.
  if (n * 512 > MEMORY_BUDGET) throw new Error(`该模型超出 32 MB 关节数据预算（本次最多 ${MEMORY_BUDGET / 512} 轴），请减小轴数。`);
  return n;
}

export function initialPose(n) {
  const q = new Float64Array(n);
  q[0] = -0.35;
  if (n > 1) q[1] = 1.25;
  if (n > 2) q[2] = -1.45;
  if (n > 3) q[3] = -0.6;
  if (n > 4) q[4] = 0.25;
  if (n > 5) q[5] = 0.35;
  return q;
}

// Coordinate convention: world Y is up. First joint rotates about Y,
// remaining joints about local Z. Links point along local +X.
export class ArmPhysics {
  constructor(n = 6) {
    this.n = validateDOF(n);
    this.q = initialPose(n);
    this.dq = new Float64Array(n);
    this.target = this.q.slice();
    this.velocity = new Float64Array(n);
    this.torque = new Float64Array(n);
    this.inertia = new Float64Array(n);
    this.lengths = new Float64Array(n);
    this.points = new Float64Array((n + 1) * 3);
    this.axes = new Float64Array(n * 3);
    this.centers = new Float64Array(n * 3);
    this.gravityTorque = new Float64Array(n);
    this.mode = 'position';
    this.gravity = true;
    this.time = 0;
    this.contacts = 0;
    const scale = n > 7 ? 6 / n : 1;
    for (let i = 0; i < n; i++) {
      this.lengths[i] = (i === 0 ? .32 : i === 1 ? .82 : i === 2 ? .72 : .27) * scale;
    }
    let remaining = 0;
    for (let i = n - 1; i >= 0; i--) {
      remaining += this.lengths[i];
      this.inertia[i] = Math.max(.03, .45 * remaining * remaining);
    }
    this.forward();
  }

  validate(values, mode) {
    const arr = Array.from(values);
    if (arr.length !== this.n) throw new Error(`需要 ${this.n} 个关节值，收到 ${arr.length} 个。`);
    if (!arr.every(x => typeof x === 'number' && Number.isFinite(x))) throw new Error('所有关节值必须是有限数值。');
    if (mode === 'position' && arr.some(x => Math.abs(x) > Math.PI)) throw new Error('关节角度须位于 [-π, π] rad 内。');
    if (mode === 'velocity' && arr.some(x => Math.abs(x) > 6)) throw new Error('目标角速度须位于 [-6, 6] rad/s 内。');
    if (mode === 'torque' && arr.some(x => Math.abs(x) > 100)) throw new Error('关节力矩须位于 [-100, 100] N·m 内。');
    return arr;
  }

  set(values, mode) {
    const arr = this.validate(values, mode);
    if (!['position', 'velocity', 'torque'].includes(mode)) throw new Error('未知控制模式。');
    this.mode = mode;
    (mode === 'position' ? this.target : mode === 'velocity' ? this.velocity : this.torque).set(arr);
  }

  forward() {
    const p = this.points;
    p[0] = 0; p[1] = .49; p[2] = 0;
    // Rotation columns X, Y, Z. World yaw is applied only at the base.
    let xx = Math.cos(this.q[0]), xy = 0, xz = -Math.sin(this.q[0]);
    let yx = 0, yy = 1, yz = 0;
    const zx = Math.sin(this.q[0]), zy = 0, zz = Math.cos(this.q[0]);
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      if (i === 0) { this.axes[k] = 0; this.axes[k + 1] = 1; this.axes[k + 2] = 0; }
      else {
        this.axes[k] = zx; this.axes[k + 1] = zy; this.axes[k + 2] = zz;
        const c = Math.cos(this.q[i]), s = Math.sin(this.q[i]);
        const nx = xx * c + yx * s, ny = xy * c + yy * s, nz = xz * c + yz * s;
        yx = yx * c - xx * s; yy = yy * c - xy * s; yz = yz * c - xz * s;
        xx = nx; xy = ny; xz = nz;
      }
      const length = this.lengths[i];
      p[k + 3] = p[k] + xx * length;
      p[k + 4] = p[k + 1] + xy * length;
      p[k + 5] = p[k + 2] + xz * length;
      this.centers[k] = (p[k] + p[k + 3]) * .5;
      this.centers[k + 1] = (p[k + 1] + p[k + 4]) * .5;
      this.centers[k + 2] = (p[k + 2] + p[k + 5]) * .5;
    }
    // Backward aggregate of gravity moments; O(N), no dense mass matrix.
    let sx = 0, sz = 0, count = 0;
    const mass = Math.min(.55, 3.3 / this.n);
    for (let i = this.n - 1; i >= 0; i--) {
      const k = i * 3;
      sx += this.centers[k]; sz += this.centers[k + 2]; count++;
      const rx = sx - count * p[k], rz = sz - count * p[k + 2];
      this.gravityTorque[i] = this.gravity ? mass * 9.81 * (rz * this.axes[k] - rx * this.axes[k + 2]) : 0;
    }
    return p;
  }

  step(dt = DT) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > .1) throw new Error('dt 必须位于 (0, 0.1] 秒内。');
    const substeps = Math.ceil(dt / DT), h = dt / substeps;
    for (let s = 0; s < substeps; s++) {
      this.forward();
      const before = this.q.slice();
      for (let i = 0; i < this.n; i++) {
        const inertia = this.inertia[i];
        let command = this.torque[i];
        if (this.mode === 'position') command = inertia * (95 * (this.target[i] - this.q[i]) - 19 * this.dq[i]) - this.gravityTorque[i];
        if (this.mode === 'velocity') command = inertia * 18 * (this.velocity[i] - this.dq[i]) - this.gravityTorque[i];
        const accel = (clamp(command, -100, 100) + this.gravityTorque[i] - .16 * this.dq[i]) / inertia;
        this.dq[i] = clamp(this.dq[i] + accel * h, -6, 6);
        this.q[i] += this.dq[i] * h;
        if (Math.abs(this.q[i]) > Math.PI) { this.q[i] = clamp(this.q[i], -Math.PI, Math.PI); this.dq[i] = 0; }
      }
      this.forward();
      // Conservative ground contact: roll back the penetrating substep.
      let contact = false;
      for (let i = 1; i <= this.n; i++) if (this.points[i * 3 + 1] < .045) { contact = true; break; }
      if (contact) { this.q.set(before); this.dq.fill(0); this.contacts++; this.forward(); }
      this.time += h;
    }
  }

  snapshot() {
    return {q: Array.from(this.q), dq: Array.from(this.dq), target: Array.from(this.target), velocity: Array.from(this.velocity), torque: Array.from(this.torque), mode: this.mode, time: this.time, contacts: this.contacts};
  }

  restore(state) {
    this.q.set(state.q); this.dq.set(state.dq);
    if (state.target) this.target.set(state.target);
    if (state.velocity) this.velocity.set(state.velocity);
    if (state.torque) this.torque.set(state.torque);
    this.mode = state.mode; this.time = state.time; this.contacts = state.contacts || 0;
    this.forward();
  }
}
