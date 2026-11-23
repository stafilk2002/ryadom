'use strict';
/* =====================================================================
   РЕАКЦИИ: всплывающие эмодзи, полноэкранные эффекты и распознавание
   жестов (как реакции в FaceTime). Жесты распознаются локально в
   браузере (MediaPipe, файлы лежат рядом с сайтом), кадры никуда
   не отправляются — по сети уходит только название эффекта.
   ===================================================================== */
const FX_NAMES = { fireworks: 'Фейерверк', confetti: 'Конфетти', balloons: 'Шарики', hearts: 'Сердечки', rain: 'Дождь', lasers: 'Лазеры', thumbsup: 'Класс', thumbsdown: 'Не очень' };
const FX_COLORS = ['#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#0a84ff', '#bf5af2', '#ff375f'];

const FX = {
  cv: null, g: null, parts: [], overlays: [], running: false, last: 0, W: 0, H: 0,
  init() {
    this.cv = $('#fxLayer'); this.g = this.cv.getContext('2d');
    const rs = () => { const d = Math.min(2, devicePixelRatio || 1); this.W = innerWidth; this.H = innerHeight; this.cv.width = this.W * d; this.cv.height = this.H * d; this.g.setTransform(d, 0, 0, d, 0, 0); };
    rs(); addEventListener('resize', rs);
  },
  emoji(e, name, big) {
    const layer = $('#emojiLayer'); if (!layer) return;
    const count = REDUCED.matches ? 1 : big ? 10 : 7;
    const baseX = 50 + (Math.random() * 40 - 20);
    for (let i = 0; i < count; i++) {
      const main = i === 0;
      const size = main ? (big ? 132 : 68) : 24 + Math.random() * 30;
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
  caption(kind, name) {
    const c = h('div', { class: 'fx-caption glass-strong', text: (name ? name + ' · ' : '') + (FX_NAMES[kind] || '') });
    document.body.append(c);
    setTimeout(() => { c.classList.add('out'); setTimeout(() => c.remove(), 320); }, 2400);
  },
  effect(kind, name) {
    if (!FX_KINDS.includes(kind)) return;
    if (kind === 'thumbsup') return this.emoji('👍', name, true);
    if (kind === 'thumbsdown') return this.emoji('👎', name, true);
    if (name) this.caption(kind, name);
    if (REDUCED.matches) { this.emoji({ fireworks: '🎆', confetti: '🎊', balloons: '🎈', hearts: '❤️', rain: '🌧️', lasers: '✨' }[kind], null); return; }
    const W = this.W, H = this.H, R = Math.random;
    const add = p => this.parts.push(p);
    if (kind === 'fireworks') {
      for (let i = 0; i < 7; i++) add({ t: 'rocket', delay: i * .35 + R() * .2, x: W * (.15 + R() * .7), y: H + 10, vy: -(H * (1.05 + R() * .35)), ty: H * (.12 + R() * .3), color: FX_COLORS[(R() * FX_COLORS.length) | 0] });
    } else if (kind === 'confetti') {
      for (let i = 0; i < 190; i++) add({ t: 'conf', x: R() * W, y: -20 - R() * H * .6, vx: R() * 80 - 40, vy: 140 + R() * 160, rot: R() * 6, vr: R() * 8 - 4, w: 6 + R() * 5, h: 10 + R() * 7, f: 2 + R() * 3, ph: R() * 6, color: FX_COLORS[(R() * FX_COLORS.length) | 0] });
    } else if (kind === 'balloons') {
      for (let i = 0; i < 16; i++) add({ t: 'balloon', x: W * (.05 + R() * .9), y: H + 60 + R() * H * .5, vy: -(110 + R() * 70), r: 26 + R() * 18, ph: R() * 6, color: FX_COLORS[(R() * FX_COLORS.length) | 0] });
    } else if (kind === 'hearts') {
      for (let i = 0; i < 40; i++) add({ t: 'heart', x: W * (.05 + R() * .9), y: H + 20 + R() * H * .5, vy: -(140 + R() * 120), s: 12 + R() * 22, ph: R() * 6, color: ['#ff375f', '#ff453a', '#ff6b8a', '#ff2d55'][(R() * 4) | 0] });
    } else if (kind === 'rain') {
      this.overlays.push({ t: 'dark', life: 4.2, max: 4.2 });
      for (let i = 0; i < 320; i++) add({ t: 'drop', delay: R() * 3.2, x: R() * W * 1.1, y: -20 - R() * 120, vy: 900 + R() * 500, len: 14 + R() * 18 });
    } else if (kind === 'lasers') {
      const cols = ['#30d158', '#bf5af2', '#0a84ff', '#ff375f', '#64d2ff', '#ffd60a'];
      for (let i = 0; i < 8; i++) add({ t: 'laser', x: W * (i < 4 ? .08 + i * .06 : .74 + (i - 4) * .06), life: 3.6, max: 3.6, sp: 1.2 + R() * 1.6, ph: R() * 6, color: cols[i % cols.length], dir: i < 4 ? 1 : -1 });
    }
    if (!this.running) { this.running = true; this.last = performance.now(); requestAnimationFrame(t => this.loop(t)); }
  },
  loop(now) {
    const dt = Math.min(.05, (now - this.last) / 1000); this.last = now;
    const g = this.g, W = this.W, H = this.H;
    g.clearRect(0, 0, W, H);
    this.overlays = this.overlays.filter(o => (o.life -= dt) > 0);
    for (const o of this.overlays) { const k = Math.min(1, (o.max - o.life) / .6, o.life / .8); g.fillStyle = `rgba(10,14,30,${.32 * k})`; g.fillRect(0, 0, W, H); }
    const next = [];
    for (const p of this.parts) if (this.step(p, dt, g, W, H, next)) next.push(p);
    this.parts = next;
    if (this.parts.length || this.overlays.length) requestAnimationFrame(t => this.loop(t));
    else { this.running = false; g.clearRect(0, 0, W, H); }
  },
  step(p, dt, g, W, H, out) {
    if (p.delay > 0) { p.delay -= dt; return true; }
    switch (p.t) {
      case 'rocket': {
        p.y += p.vy * dt; p.vy += H * .55 * dt;
        g.fillStyle = p.color; g.globalAlpha = .9; g.beginPath(); g.arc(p.x, p.y, 2.4, 0, 7); g.fill();
        g.globalAlpha = .35; g.fillRect(p.x - 1, p.y, 2, 26); g.globalAlpha = 1;
        if (p.y <= p.ty || p.vy >= 0) {
          for (let i = 0; i < 80; i++) { const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 230; out.push({ t: 'spark', x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1 + Math.random() * .9, max: 1.9, color: Math.random() < .2 ? '#fff' : p.color }); }
          return false;
        }
        return true;
      }
      case 'spark': {
        p.life -= dt; if (p.life <= 0) return false;
        p.vx *= 1 - 1.6 * dt; p.vy = p.vy * (1 - 1.6 * dt) + 140 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        g.globalCompositeOperation = 'lighter'; g.globalAlpha = Math.min(1, p.life / .8);
        g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y, 2.2, 0, 7); g.fill();
        g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
        return true;
      }
      case 'conf': {
        p.ph += dt * p.f; p.x += (p.vx + Math.sin(p.ph) * 60) * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        if (p.y > H + 30) return false;
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, Math.abs(Math.cos(p.ph))); g.fillStyle = p.color; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
        return true;
      }
      case 'balloon': {
        p.ph += dt * 1.4; p.y += p.vy * dt; const x = p.x + Math.sin(p.ph) * 18;
        if (p.y < -p.r * 4) return false;
        g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, p.y + p.r * 1.15);
        g.quadraticCurveTo(x - 10, p.y + p.r * 2, x + 4, p.y + p.r * 3.1); g.stroke();
        const gr = g.createRadialGradient(x - p.r * .35, p.y - p.r * .45, p.r * .1, x, p.y, p.r * 1.2);
        gr.addColorStop(0, 'rgba(255,255,255,.85)'); gr.addColorStop(.25, p.color); gr.addColorStop(1, p.color);
        g.fillStyle = gr; g.beginPath(); g.ellipse(x, p.y, p.r * .86, p.r * 1.06, 0, 0, 7); g.fill();
        g.beginPath(); g.moveTo(x - 4, p.y + p.r * 1.12); g.lineTo(x + 4, p.y + p.r * 1.12); g.lineTo(x, p.y + p.r * 1.02); g.fill();
        return true;
      }
      case 'heart': {
        p.ph += dt * 2; p.y += p.vy * dt; const x = p.x + Math.sin(p.ph) * 14, s = p.s;
        if (p.y < -40) return false;
        g.globalAlpha = Math.min(1, (p.y / H) * 2.2); g.fillStyle = p.color;
        g.beginPath(); g.moveTo(x, p.y + s * .3);
        g.bezierCurveTo(x - s * .9, p.y - s * .35, x - s * .45, p.y - s, x, p.y - s * .45);
        g.bezierCurveTo(x + s * .45, p.y - s, x + s * .9, p.y - s * .35, x, p.y + s * .3); g.fill(); g.globalAlpha = 1;
        return true;
      }
      case 'drop': {
        p.y += p.vy * dt; p.x -= p.vy * .12 * dt;
        if (p.y > H + 30) return false;
        g.strokeStyle = 'rgba(190,210,255,.55)'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + p.len * .12, p.y - p.len); g.stroke();
        return true;
      }
      case 'laser': {
        p.life -= dt; if (p.life <= 0) return false;
        const k = Math.min(1, (p.max - p.life) / .3, p.life / .5);
        const a = -Math.PI / 2 + p.dir * (.25 + .45 * Math.sin(p.ph + (p.max - p.life) * p.sp));
        const L = Math.hypot(W, H);
        g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = .85 * k;
        g.strokeStyle = p.color; g.lineWidth = 5; g.shadowColor = p.color; g.shadowBlur = 22;
        g.beginPath(); g.moveTo(p.x, H + 4); g.lineTo(p.x + Math.cos(a) * L, H + Math.sin(a) * L); g.stroke();
        g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke(); g.restore();
        return true;
      }
    }
    return false;
  },
};

/* ---------- жесты ---------- */
const GEST_MAP = {
  '1:Thumb_Up': 'thumbsup', '2:Thumb_Up': 'fireworks',
  '1:Thumb_Down': 'thumbsdown', '2:Thumb_Down': 'rain',
  '1:Victory': 'balloons', '2:Victory': 'confetti',
  '1:ILoveYou': 'hearts', '2:ILoveYou': 'lasers',
};
const Gest = {
  enabled: ls.get('gestures', !IS_TOUCH), rec: null, loading: null, timer: 0, hist: [], cool: 0, hook: null, hookUntil: 0, failed: false,
  setEnabled(v) {
    this.enabled = v; ls.set('gestures', v);
    $('[data-act=gestures]').classList.toggle('on', v);
    $('#gestSwitch').setAttribute('aria-checked', String(v));
    if (v && S.inCall && !M.camOn) toast('Жесты заработают, когда включится камера', { icon: 'hand' });
    else if (v) toast('Покажите в камеру большой палец или «викторию»', { icon: 'hand' });
    this.failed = false; this.sync();
  },
  async load() {
    if (this.rec) return this.rec;
    if (!this.loading) {
      this.loading = (async () => {
        const base = new URL('vendor/mediapipe/', document.baseURI).href;
        const { FilesetResolver, GestureRecognizer } = await import(base + 'vision_bundle.mjs');
        const files = await FilesetResolver.forVisionTasks(base + 'wasm');
        const opts = d => ({ baseOptions: { modelAssetPath: base + 'gesture_recognizer.task', delegate: d }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: .6, minHandPresenceConfidence: .6, minTrackingConfidence: .5 });
        try { this.rec = await GestureRecognizer.createFromOptions(files, opts('GPU')); }
        catch { this.rec = await GestureRecognizer.createFromOptions(files, opts('CPU')); }
        return this.rec;
      })();
    }
    try { return await this.loading; } catch (e) { this.loading = null; throw e; }
  },
  async sync() {
    const want = (this.enabled || this.hook) && S.inCall && M.camOn && M.camTrack && !M.screenTrack && !document.hidden && !this.failed;
    const v = $('#gestVideo');
    if (!want) { clearInterval(this.timer); this.timer = 0; if (v.srcObject) v.srcObject = null; return; }
    if ((v._t || null) !== M.camTrack) { v._t = M.camTrack; v.srcObject = new MediaStream([M.camTrack]); v.play().catch(() => {}); }
    if (this.timer) return;
    this.timer = -1;
    try { await this.load(); }
    catch (e) { console.warn('gestures', e); this.failed = true; this.timer = 0; toast('Распознавание жестов недоступно на этом устройстве', { icon: 'hand' }); return; }
    if (this.timer !== -1) return;
    this.timer = setInterval(() => this.tick(), 110);
  },
  tick() {
    const v = $('#gestVideo');
    if (!this.rec || v.readyState < 2 || !v.videoWidth) return;
    let res; try { res = this.rec.recognizeForVideo(v, performance.now()); } catch { return; }
    const hands = (res.gestures || []).map(x => x && x[0]).filter(x => x && x.score > .62 && x.categoryName !== 'None');
    let label = '';
    if (hands.length >= 2 && hands[0].categoryName === hands[1].categoryName) label = '2:' + hands[0].categoryName;
    else if (hands.length) label = '1:' + hands.sort((a, b) => b.score - a.score)[0].categoryName;
    this.hist.push(label); if (this.hist.length > 6) this.hist.shift();
    const need = 5;
    if (label && this.hist.length >= need && this.hist.slice(-need).every(x => x === label)) this.fire(label);
  },
  fire(label) {
    const now = performance.now(), cat = label.slice(2);
    if (this.hook) { if (now < this.hookUntil) return; this.hookUntil = now + 700; this.hist = []; this.hook(cat); return; }
    if (!this.enabled || now < this.cool) return;
    const k = GEST_MAP[label] || GEST_MAP['1:' + cat]; if (!k) return;
    this.cool = now + 4000; this.hist = [];
    FX.effect(k, me.name); send({ t: 'fx', k });
  },
};
window.addEventListener('DOMContentLoaded', () => FX.init());
