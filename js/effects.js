'use strict';
/* =====================================================================
   РЕАКЦИИ: всплывающие эмодзи (кнопки реакций) и конфетти для победы
   в игре. Всё рисуется локально; по сети уходит только сама реакция.
   ===================================================================== */
const FX_COLORS = ['#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#0a84ff', '#bf5af2', '#ff375f'];

const FX = {
  cv: null, g: null, parts: [], running: false, last: 0, W: 0, H: 0,
  init() {
    this.cv = $('#fxLayer'); this.g = this.cv.getContext('2d');
    const rs = () => { const d = Math.min(2, devicePixelRatio || 1); this.W = innerWidth; this.H = innerHeight; this.cv.width = this.W * d; this.cv.height = this.H * d; this.g.setTransform(d, 0, 0, d, 0, 0); };
    rs(); addEventListener('resize', rs);
  },
  emoji(e, name) {
    const layer = $('#emojiLayer'); if (!layer) return;
    const count = REDUCED.matches ? 1 : 7;
    const baseX = 50 + (Math.random() * 40 - 20);
    for (let i = 0; i < count; i++) {
      const main = i === 0;
      const size = main ? 68 : 24 + Math.random() * 30;
      const el = h('div', { class: 'fly' }, h('i', { text: e }));
      const x = Math.max(4, Math.min(92, baseX + (main ? 0 : Math.random() * 44 - 22)));
      el.style.left = `calc(${x}% - ${size / 2}px)`;
      el.style.setProperty('--size', size + 'px');
      el.style.setProperty('--dur', (main ? 3.3 : 2.1 + Math.random() * 1.5) + 's');
      el.style.setProperty('--dx', (8 + Math.random() * 26) + 'px');
      el.style.setProperty('--sway-t', (.9 + Math.random() * .8) + 's');
      el.style.setProperty('--rise', -(58 + Math.random() * 32) + 'vh');
      if (!main) el.style.animationDelay = (Math.random() * .45) + 's';
      if (main && name) el.append(h('span', { class: 'fly-name', text: name }));
      el.addEventListener('animationend', ev => { if (ev.target === el) el.remove(); });
      layer.append(el);
    }
  },
  confetti() {
    if (REDUCED.matches) return;
    const W = this.W, H = this.H, R = Math.random;
    for (let i = 0; i < 170; i++) this.parts.push({ x: R() * W, y: -20 - R() * H * .6, vx: R() * 80 - 40, vy: 140 + R() * 160, rot: R() * 6, vr: R() * 8 - 4, w: 6 + R() * 5, h: 10 + R() * 7, f: 2 + R() * 3, ph: R() * 6, color: FX_COLORS[(R() * FX_COLORS.length) | 0] });
    if (!this.running) { this.running = true; this.last = performance.now(); requestAnimationFrame(t => this.loop(t)); }
  },
  loop(now) {
    const dt = Math.min(.05, (now - this.last) / 1000); this.last = now;
    const g = this.g, H = this.H;
    g.clearRect(0, 0, this.W, H);
    this.parts = this.parts.filter(p => {
      p.ph += dt * p.f; p.x += (p.vx + Math.sin(p.ph) * 60) * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.y > H + 30) return false;
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, Math.abs(Math.cos(p.ph))); g.fillStyle = p.color; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
      return true;
    });
    if (this.parts.length) requestAnimationFrame(t => this.loop(t));
    else { this.running = false; g.clearRect(0, 0, this.W, H); }
  },
};
window.addEventListener('DOMContentLoaded', () => FX.init());
