// Движок летящего куба: геометрия икосаэдра, кватернионы, физика броска и отрисовка на canvas.
// Взят из расширения «Кубик d20» (та же авторка) без изменений логики: у «Кадра» своя копия, чтобы работать без него.
// Используются только d20 и бросок двух кубиков (преимущество, помеха).
/**
 * Ядро кубика d20: геометрия икосаэдра, кватернионы, физика броска и отрисовка на canvas.
 * Модуль не трогает DOM при импорте, поэтому математика и физика тестируются в Node.
 *
 * Идея: результат бросается заранее (crypto), физика лишь красиво его "доигрывает":
 * кубик летит, отскакивает, теряет скорость, а в конце плавно доворачивается так,
 * чтобы нужная грань смотрела на зрителя. Честность броска от анимации не зависит.
 */

const PHI = (1 + Math.sqrt(5)) / 2;

// ---------- векторы и кватернионы ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlen = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export const qmul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];

export function qnorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export function qrot(q, v) {
  const [w, x, y, z] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

export function qAxisAngle(axis, angle) {
  const s = Math.sin(angle / 2);
  return [Math.cos(angle / 2), axis[0] * s, axis[1] * s, axis[2] * s];
}

export function qFromTo(a, b) {
  const d = dot(a, b);
  if (d < -0.999999) {
    let axis = cross([1, 0, 0], a);
    if (vlen(axis) < 1e-6) axis = cross([0, 1, 0], a);
    axis = norm(axis);
    return [0, axis[0], axis[1], axis[2]];
  }
  const c = cross(a, b);
  return qnorm([1 + d, c[0], c[1], c[2]]);
}

export function qSlerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) { bb = [-b[0], -b[1], -b[2], -b[3]]; d = -d; }
  if (d > 0.9995) {
    return qnorm(a.map((c, i) => c + (bb[i] - c) * t));
  }
  const th0 = Math.acos(d);
  const th = th0 * t;
  const s0 = Math.cos(th) - d * Math.sin(th) / Math.sin(th0);
  const s1 = Math.sin(th) / Math.sin(th0);
  return qnorm(a.map((c, i) => c * s0 + bb[i] * s1));
}

/** Интегрирование ориентации по угловой скорости w (рад/с, мировые оси). */
export function qIntegrate(q, w, dt) {
  const dq = qmul([0, w[0], w[1], w[2]], q);
  return qnorm([q[0] + 0.5 * dt * dq[0], q[1] + 0.5 * dt * dq[1], q[2] + 0.5 * dt * dq[2], q[3] + 0.5 * dt * dq[3]]);
}

// ---------- геометрия ----------
const RAW_VERTS = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];

/**
 * Выпуклый многогранник по вершинам: грани находятся перебором плоскостей (вершин мало).
 * Радиус описанной сферы приводится к 1. У каждой грани: вершины по кругу, нормаль наружу,
 * центр, оси текста, радиус вписанной окружности (rad) и номер.
 * Нумерация как на настоящих костях: противоположные грани дают в сумме sides + 1
 * (у d4 противоположных граней нет, номера идут подряд).
 * vis: во сколько раз рисовать меньше или больше, чтобы кости выглядели соразмерно.
 */
export function buildPoly(rawVerts, sides, vis = 1) {
  const mx = Math.max(...rawVerts.map(vlen));
  const verts = rawVerts.map(v => mul(v, 1 / mx));
  const N = verts.length;
  const found = new Map();
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) for (let k = j + 1; k < N; k++) {
    let n = cross(sub(verts[j], verts[i]), sub(verts[k], verts[i]));
    const l = vlen(n);
    if (l < 1e-9) continue;
    n = mul(n, 1 / l);
    let d = dot(n, verts[i]);
    let pos = false, neg = false;
    for (const v of verts) {
      const s = dot(n, v) - d;
      if (s > 1e-6) pos = true; else if (s < -1e-6) neg = true;
    }
    if (pos && neg) continue;
    if (pos) { n = mul(n, -1); d = -d; }
    const ids = [];
    verts.forEach((v, m) => { if (Math.abs(dot(n, v) - d) < 1e-6) ids.push(m); });
    const key = ids.join(',');
    if (!found.has(key)) found.set(key, { ids, n });
  }
  const faces = [...found.values()].map(({ ids, n }) => {
    const c = mul(ids.map(m => verts[m]).reduce(add), 1 / ids.length);
    const e1 = norm(sub(verts[ids[0]], c));
    const e2 = cross(n, e1);
    const ang = m => Math.atan2(dot(sub(verts[m], c), e2), dot(sub(verts[m], c), e1));
    ids.sort((a, b) => ang(a) - ang(b));
    const P = ids.map(m => verts[m]);
    const edges = P.map((p, i) => [p, P[(i + 1) % P.length]]);
    const rad = Math.min(...edges.map(([a, b]) => vlen(cross(sub(b, a), sub(c, a))) / vlen(sub(b, a))));
    let target;
    if (P.length === 4) {
      const lens = edges.map(([a, b]) => vlen(sub(b, a)));
      const square = Math.max(...lens) - Math.min(...lens) < 1e-4;
      // квадрат: цифра стоит на ребре; "воздушный змей" (d10): цифра смотрит на дальнюю вершину
      target = square ? mul(add(P[0], P[1]), 0.5) : P.reduce((b, p) => (vlen(sub(p, c)) > vlen(sub(b, c)) ? p : b));
    } else {
      target = P[0];
    }
    const up = norm(sub(target, c));
    return { idx: ids, n, c, up, right: cross(up, n), rad, num: 0 };
  });
  if (sides === 4) {
    faces.forEach((f, i) => { f.num = i + 1; });
  } else {
    let next = 1;
    faces.forEach((f, i) => {
      if (f.num) return;
      const j = faces.findIndex((g, jj) => jj !== i && dot(f.n, g.n) < -0.999);
      f.num = next;
      faces[j].num = sides + 1 - next;
      next++;
    });
  }
  return { sides, verts, faces, vis };
}

/** Пентагональный трапецоэдр (d10): две вершины-полюса и зигзаг из десяти вершин между ними. */
function d10Verts() {
  const c36 = Math.cos(Math.PI / 5);
  const z0 = (1 - c36) / (1 + c36); // при таком z0 грани-"воздушные змеи" плоские
  const ring = Array.from({ length: 10 }, (_, k) => [
    Math.cos(k * Math.PI / 5), Math.sin(k * Math.PI / 5), k % 2 === 0 ? z0 : -z0,
  ]);
  return [[0, 0, 1], [0, 0, -1], ...ring];
}

const cubeVerts = [];
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) cubeVerts.push([x, y, z]);
const iPHI = 1 / PHI;
const dodecaVerts = [...cubeVerts];
for (const a of [-1, 1]) for (const b of [-1, 1]) {
  dodecaVerts.push([0, a * iPHI, b * PHI], [a * iPHI, b * PHI, 0], [a * PHI, 0, b * iPHI]);
}

/** Все кости по числу граней. */
export const POLYS = {
  4: buildPoly([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]], 4, 0.95),
  6: buildPoly(cubeVerts, 6, 0.8),
  8: buildPoly([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], 8, 0.9),
  10: buildPoly(d10Verts(), 10, 0.95),
  12: buildPoly(dodecaVerts, 12, 0.9),
  20: buildPoly(RAW_VERTS, 20, 1),
};
export const SIDES = Object.keys(POLYS).map(Number);

export const ICO = POLYS[20];

/** Ориентация, при которой грань faceIndex смотрит на зрителя (+Z), цифрой вверх (+-jitter). */
export function targetOrientation(faceIndex, jitter = 0, poly = ICO) {
  const f = poly.faces[faceIndex];
  const q1 = qFromTo(f.n, [0, 0, 1]);
  const up = qrot(q1, f.up);
  const cur = Math.atan2(up[1], up[0]);
  const roll = Math.PI / 2 - cur + jitter;
  return qmul(qAxisAngle([0, 0, 1], roll), q1);
}

export const faceByNumber = (n, poly = ICO) => poly.faces.findIndex(f => f.num === n);

/** Грань, которая сейчас смотрит на зрителя. */
export function topFace(q, poly = ICO) {
  let best = 0, bz = -2;
  poly.faces.forEach((f, i) => { const z = qrot(q, f.n)[2]; if (z > bz) { bz = z; best = i; } });
  return best;
}

// ---------- случайность и оценка результата ----------
export function rollInt(n) {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) return 1 + Math.floor(Math.random() * n);
  const a = new Uint32Array(1);
  const lim = Math.floor(0x100000000 / n) * n;
  let x;
  do { c.getRandomValues(a); x = a[0]; } while (x >= lim);
  return (x % n) + 1;
}

/** Итог броска. rule: 'sum' | 'adv' | 'dis' (для двух кубиков). Крит и провал только у d20. */
export function evaluate(results, rule = 'sum', sides = 20) {
  const critOf = v => (sides !== 20 ? '' : v === 20 ? 'crit' : v === 1 ? 'fumble' : '');
  if (results.length === 1) {
    const r = results[0];
    const crit = critOf(r);
    return {
      total: r, kept: 0, crit, main: String(r),
      sub: crit === 'crit' ? 'Критический успех' : crit === 'fumble' ? 'Критический провал' : '',
      summary: String(r),
    };
  }
  const [a, b] = results;
  if (rule === 'adv' || rule === 'dis') {
    const pickFirst = rule === 'adv' ? a >= b : a <= b;
    const kept = pickFirst ? 0 : 1;
    const v = results[kept];
    const crit = critOf(v);
    const label = rule === 'adv' ? 'Преимущество' : 'Помеха';
    return {
      total: v, kept, crit, main: String(v),
      sub: `${label} · ${a}, ${b}`,
      summary: `${v} (${label.toLowerCase()}: ${a}, ${b})`,
    };
  }
  return { total: a + b, kept: -1, crit: '', main: String(a + b), sub: `${a} + ${b}`, summary: `${a + b} (${a}+${b})` };
}

// ---------- физика ----------
const G = 2600;          // "гравитация" по высоте, px/с²
const REST = 0.42;       // упругость отскока
const BOUNCE_MIN = 140;  // ниже этой скорости падения отскока нет
const SETTLE_TIME = 0.55;
const HEIGHT_SCALE = 350; // во сколько раз растёт кубик с высотой (ближе к зрителю)
const rnd = k => (Math.random() * 2 - 1) * k;

export class Die {
  constructor({ x, y, h = 40, vx, vy, vh, w, q, result, jitter, poly = ICO }) {
    this.x = x; this.y = y; this.h = h;
    this.vx = vx; this.vy = vy; this.vh = vh;
    this.w = w;
    this.q = q;
    this.result = result;
    this.poly = poly;
    this.face = faceByNumber(result, poly);
    this.target = targetOrientation(this.face, jitter ?? rnd(0.6), poly);
    this.phase = 'fly';
    this.age = 0;
    this.t = 0;
    this.qFrom = q;
  }

  get done() { return this.phase === 'done'; }

  step(dt, b, onBounce) {
    if (this.phase === 'done') return;
    this.age += dt;

    if (this.phase === 'fly') {
      this.vh -= G * dt;
      this.h += this.vh * dt;
      if (this.h <= 0) {
        this.h = 0;
        if (this.vh < -BOUNCE_MIN) {
          const imp = -this.vh;
          this.vh = imp * REST;
          this.vx *= 0.8; this.vy *= 0.8;
          const k = Math.min(imp / 900, 1) * 12;
          this.w = [this.w[0] * 0.85 + rnd(k), this.w[1] * 0.85 + rnd(k), this.w[2] * 0.85 + rnd(k)];
          onBounce?.(imp);
        } else {
          this.vh = 0;
        }
      }
      const grounded = this.h === 0 && this.vh === 0;
      const fr = grounded ? Math.exp(-2.8 * dt) : 1;
      this.vx *= fr; this.vy *= fr;
      const wf = grounded ? Math.exp(-2.2 * dt) : Math.exp(-0.15 * dt);
      this.w = [this.w[0] * wf, this.w[1] * wf, this.w[2] * wf];
      this._move(dt, b);
      this.q = qIntegrate(this.q, this.w, dt);

      const slow = Math.hypot(this.vx, this.vy) < 110 && vlen(this.w) < 9;
      if ((grounded && slow) || this.age > 6) {
        this.phase = 'settle';
        this.qFrom = this.q;
        this.t = 0;
        this.h = 0; this.vh = 0;
      }
    } else if (this.phase === 'settle') {
      this.t += dt;
      const u = Math.min(1, this.t / SETTLE_TIME);
      const e = 1 - Math.pow(1 - u, 3);
      this.q = qSlerp(this.qFrom, this.target, e);
      const fr = Math.exp(-8 * dt);
      this.vx *= fr; this.vy *= fr;
      this._move(dt, b);
      if (u >= 1) { this.q = this.target; this.phase = 'done'; this.vx = this.vy = 0; }
    }
  }

  _move(dt, b) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.x < b.minX) { this.x = b.minX; this.vx = Math.abs(this.vx) * 0.55; }
    if (this.x > b.maxX) { this.x = b.maxX; this.vx = -Math.abs(this.vx) * 0.55; }
    if (this.y < b.minY) { this.y = b.minY; this.vy = Math.abs(this.vy) * 0.55; }
    if (this.y > b.maxY) { this.y = b.maxY; this.vy = -Math.abs(this.vy) * 0.55; }
  }
}

const FAR = { minX: -1e9, maxX: 1e9, minY: -1e9, maxY: 1e9 };
const THROW_VH = 620;

/** Сколько пикселей пролетает кубик на единицу начальной скорости (для прицеливания в центр). */
export function rangePerSpeed() {
  const d = new Die({ x: 0, y: 0, h: 40, vx: 1000, vy: 0, vh: THROW_VH, w: [24, 0, 0], q: [1, 0, 0, 0], result: 1, jitter: 0 });
  let guard = 0;
  while (!d.done && guard++ < 1200) d.step(1 / 60, FAR);
  return d.x / 1000;
}

/** Две "круглые" кости в горизонтальной плоскости: разводим и обмениваем импульс. */
export function collide(a, b, minDist) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  if (dist >= minDist) return false;
  const nx = dx / dist, ny = dy / dist;
  const push = (minDist - dist) / 2;
  a.x -= nx * push; a.y -= ny * push;
  b.x += nx * push; b.y += ny * push;
  const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rv < 0) {
    const j = -(1 + 0.75) * rv / 2;
    a.vx -= j * nx; a.vy -= j * ny;
    b.vx += j * nx; b.vy += j * ny;
    a.w = [a.w[0] + rnd(6), a.w[1] + rnd(6), a.w[2] + rnd(6)];
    b.w = [b.w[0] + rnd(6), b.w[1] + rnd(6), b.w[2] + rnd(6)];
  }
  return true;
}

// ---------- темы ----------
export const THEMES = {
  // accent — цвет кнопок и значков расширения, который ставится вместе с выбором оформления
  obsidian: { name: 'Обсидиан', body: [38, 40, 56], num: '#ecc979', edge: 'rgba(255,255,255,0.16)', accent: '#ecc979' },
  ivory: { name: 'Слоновая кость', body: [228, 220, 198], num: '#7a1f1f', edge: 'rgba(60,40,20,0.35)', accent: '#e4dcc6' },
  crimson: { name: 'Багрянец', body: [138, 26, 38], num: '#f4e8cb', edge: 'rgba(255,200,200,0.22)', accent: '#e4616b' },
  emerald: { name: 'Изумруд', body: [24, 98, 74], num: '#f3e5a8', edge: 'rgba(200,255,230,0.2)', accent: '#3fbf94' },
};

/** Тема кубика из своих цветов (#rrggbb). Не гарантирует, что вход корректен: плохие цвета заменяются. */
export function customTheme(bodyHex, numHex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(bodyHex));
  const n = parseInt(m ? m[1] : '262838', 16);
  const body = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (0.299 * body[0] + 0.587 * body[1] + 0.114 * body[2]) / 255;
  return {
    name: 'Свой цвет', body,
    num: /^#[0-9a-f]{6}$/i.test(numHex) ? numHex : '#ecc979',
    edge: lum > 0.55 ? 'rgba(60,40,20,0.35)' : 'rgba(255,255,255,0.18)',
  };
}

// ---------- сцена (только браузер) ----------
const LIGHT = norm([-0.35, 0.55, 0.75]);
const HALF = norm(add(LIGHT, [0, 0, 1]));

export class DiceStage {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dice = [];
    this.dim = [];
    this.size = 64;
    this.theme = THEMES.obsidian;
    this.poly = ICO;
    this.raf = 0;
    this.last = 0;
    this.landed = false;
    this.onBounce = null;
    this.onLanded = null;
    this._range = null;
    this.resize();
    window.addEventListener('resize', () => { this.resize(); if (!this.raf) this.draw(); });
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.canvas.style.width = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    this.dpr = dpr;
  }

  bounds() {
    const m = this.size * 1.05;
    return { minX: m, maxX: this.W - m, minY: m, maxY: Math.max(m + 1, this.H - m - 70) };
  }

  throwDice({ results, sides = 20, from, size, theme, onBounce, onLanded }) {
    this.poly = POLYS[sides] ?? ICO;
    this.size = size;
    this.theme = theme;
    this.onBounce = onBounce;
    this.onLanded = onLanded;
    this.landed = false;
    this.dim = results.map(() => false);
    this._range ??= rangePerSpeed();

    const n = results.length;
    const b = this.bounds();
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    this.dice = results.map((r, i) => {
      const spread = (i - (n - 1) / 2) * this.size * 2.7;
      const tx = clamp(this.W / 2 + spread + rnd(this.W * 0.06), b.minX, b.maxX);
      const ty = clamp(this.H * 0.44 + rnd(this.H * 0.05), b.minY, b.maxY);
      const sx = from[0] + i * 26, sy = from[1] - i * 14;
      let dx = tx - sx, dy = ty - sy;
      const dist = Math.hypot(dx, dy) || 1;
      dx /= dist; dy /= dist;
      const speed = (dist / this._range) * (1 + rnd(0.08));
      const axis = norm([rnd(1), rnd(1), rnd(1)]);
      const wMag = 18 + Math.random() * 12;
      return new Die({
        x: sx, y: sy, h: 40,
        vx: dx * speed, vy: dy * speed, vh: THROW_VH + rnd(80),
        w: mul(axis, wMag),
        q: qnorm([rnd(1) + 0.01, rnd(1), rnd(1), rnd(1)]),
        result: r,
        poly: this.poly,
      });
    });
    this.last = 0;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(ts => this._frame(ts));
  }

  setDim(i, v) { this.dim[i] = v; if (!this.raf) this.draw(); }

  clear() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.dice = [];
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Центр и низ группы кубиков, для подписи с результатом. */
  anchor() {
    if (!this.dice.length) return null;
    const x = this.dice.reduce((s, d) => s + d.x, 0) / this.dice.length;
    const y = Math.max(...this.dice.map(d => d.y)) + this.size * 1.1;
    return { x, y };
  }

  _frame(ts) {
    const dt = this.last ? Math.min((ts - this.last) / 1000, 1 / 30) : 1 / 60;
    this.last = ts;
    const b = this.bounds();
    const hook = imp => this.onBounce?.(imp);
    for (let s = 0; s < 2; s++) {
      for (const d of this.dice) d.step(dt / 2, b, hook);
      if (this.dice.length === 2 && this.dice.every(d => d.h < 30)) {
        collide(this.dice[0], this.dice[1], this.size * 1.7);
      }
    }
    this.draw();
    if (this.dice.every(d => d.done)) {
      this.raf = 0;
      if (!this.landed) { this.landed = true; this.onLanded?.(); }
      return;
    }
    this.raf = requestAnimationFrame(t => this._frame(t));
  }

  draw() {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    for (const d of this.dice) this._shadow(d);
    this.dice.forEach((d, i) => {
      c.globalAlpha = this.dim[i] ? 0.4 : 1;
      this._die(d);
    });
    c.globalAlpha = 1;
  }

  _shadow(d) {
    const c = this.ctx;
    const k = 1 + d.h / HEIGHT_SCALE;
    const r = this.size * 0.95 * k;
    const sx = d.x + d.h * 0.28, sy = d.y + d.h * 0.4;
    const a = 0.42 / (1 + d.h / 90);
    const g = c.createRadialGradient(sx, sy, r * 0.15, sx, sy, r * 1.1);
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(sx, sy, r * 1.1, r * 0.95, 0, 0, Math.PI * 2);
    c.fill();
  }

  _die(d) {
    const c = this.ctx;
    const poly = d.poly;
    const S = this.size * poly.vis * (1 + d.h / HEIGHT_SCALE);
    const th = this.theme;
    const rv = poly.verts.map(v => qrot(d.q, v));
    const px = i => d.x + rv[i][0] * S;
    const py = i => d.y - rv[i][1] * S;

    for (const f of poly.faces) {
      const n = qrot(d.q, f.n);
      if (n[2] <= 0.01) continue;
      const lam = Math.max(0, dot(n, LIGHT));
      const spec = Math.pow(Math.max(0, dot(n, HALF)), 28) * 70;
      const lit = 0.34 + 0.66 * lam;
      const col = th.body.map(v => Math.min(255, Math.round(v * lit + spec)));
      c.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      c.strokeStyle = th.edge;
      c.lineWidth = Math.max(1, S * 0.03);
      c.lineJoin = 'round';
      c.beginPath();
      c.moveTo(px(f.idx[0]), py(f.idx[0]));
      for (let m = 1; m < f.idx.length; m++) c.lineTo(px(f.idx[m]), py(f.idx[m]));
      c.closePath();
      c.fill();
      c.stroke();

      // Цифра: проекция ортографическая, значит текстура ложится на грань аффинно.
      const cc = qrot(d.q, f.c);
      const r3 = qrot(d.q, f.right);
      const u3 = qrot(d.q, f.up);
      // 0.3035 — радиус вписанной окружности грани d20, под него подобран размер цифры
      const K = S / 100 * Math.min(1.2, f.rad / 0.3035);
      c.save();
      c.transform(r3[0] * K, -r3[1] * K, -u3[0] * K, u3[1] * K, d.x + cc[0] * S, d.y - cc[1] * S);
      c.fillStyle = th.num;
      c.font = '700 34px Georgia, "Times New Roman", serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.globalAlpha *= 0.55 + 0.45 * n[2];
      const label = String(f.num);
      c.fillText(label, 0, 2);
      if (poly.sides >= 10 && (f.num === 6 || f.num === 9)) {
        const w = c.measureText(label).width;
        c.fillRect(-w / 2, 20, w, 3.5);
      }
      c.restore();
    }
  }
}
