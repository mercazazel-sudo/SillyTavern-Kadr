/**
 * Линия пульса для окна «Состояние»: бегущая кардиограмма, форма и частота зависят от настроения и его силы.
 * Рисуется на canvas, останавливается вызовом stop() (при перерисовке окна и закрытии). При «уменьшить движение» рисуется один кадр.
 */
const beatShape = ph => {                       // форма одного удара: P, QRS, T; ph от 0 до 1
  const g = (c, w, a) => a * Math.exp(-Math.pow((ph - c) / w, 2));
  return g(0.16, 0.035, 0.18) - g(0.30, 0.012, 0.22) + g(0.33, 0.012, 1.0) - g(0.36, 0.014, 0.32) + g(0.58, 0.06, 0.30);
};

export function startPulse(canvas, mood, lvl = 2, { flat = false } = {}) {
  if (flat) mood = { ...mood, color: '#8a8a94', amp: 0, jit: 0, spike: 0, irr: 0 };       // умер: ровная линия вместо пульса
  const ctx = canvas.getContext('2d');
  const d = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(10, Math.round((rect.width || 600) * d));
  canvas.height = Math.max(10, Math.round((rect.height || 100) * d));
  const k = 0.75 + lvl * 0.25;                  // сила настроения делает линию выше
  const bpm = mood.bpm * (mood.id === 'calm' || mood.id === 'sad' ? 1 : 0.9 + lvl * 0.07);
  const speed = 140;                            // пикселей CSS в секунду
  const buf = [];
  let phase = 0, interval = 1, seed = 7, last = performance.now(), raf = 0, stopped = false;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const step = n => {
    for (let s = 0; s < n; s++) {
      const beatLen = (60 / bpm) * speed * d * (1 + (interval - 1) * mood.irr);
      phase += 1 / beatLen;
      if (phase >= 1) { phase -= 1; interval = 1 + (rnd() - 0.5) * 2 * mood.irr * 1.6; }
      if (flat) { buf.push(0); continue; }
      let v = beatShape(phase) * mood.amp * k;
      if (mood.spike && phase > 0.28 && phase < 0.4) v *= 1 + mood.spike * 0.9;
      v += (rnd() - 0.5) * mood.jit * 0.5;
      buf.push(v);
    }
    if (buf.length > canvas.width) buf.splice(0, buf.length - canvas.width);
  };
  const draw = () => {
    const W = canvas.width, H = canvas.height, base = H * 0.64, scale = H * 0.5;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 2.2 * d; ctx.lineJoin = 'round'; ctx.strokeStyle = mood.color; ctx.shadowColor = mood.color; ctx.shadowBlur = 10 * d;
    ctx.beginPath();
    const off = W - buf.length;
    buf.forEach((v, i) => { const x = off + i, y = base - v * scale; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke(); ctx.shadowBlur = 0;
    const lv = buf[buf.length - 1] ?? 0; ctx.fillStyle = mood.color; ctx.beginPath(); ctx.arc(W - 2, base - lv * scale, 4 * d, 0, 6.3); ctx.fill();
  };
  const frame = now => {
    if (stopped) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    step(Math.max(1, Math.round(speed * dt * d)));
    draw();
    raf = requestAnimationFrame(frame);
  };
  step(canvas.width);
  draw();
  if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) raf = requestAnimationFrame(frame);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}

/** Крошечная ломаная пульса для списка людей. */
export function miniPulsePath(mood) {
  let d = '';
  for (let i = 0; i <= 24; i++) {
    const k = i % 8;
    const y = 8 - (k === 3 ? -5 * mood.amp : k === 4 ? 7 * mood.amp : k === 5 ? -4 * mood.amp : Math.sin(i * 1.3) * mood.jit * 6);
    d += `${i ? 'L' : 'M'}${i * 3} ${Math.max(1, Math.min(15, y)).toFixed(1)}`;
  }
  return d;
}
