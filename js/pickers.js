'use strict';
/* =====================================================================
   ВЫБОР ДАТЫ, ВРЕМЕНИ И ДЛИТЕЛЬНОСТИ
   - Spring: крошечный движок пружин (как в Jelly slider: «жёсткость затухание»)
   - JellySlider: бегунок тянется со скоростью, над ним поднимается капля
     со значением; шкала нелинейная, чтобы в начале хватало точности до минуты;
     на явных отметках бегунок примагничивается
   - Pop: всплывающее окно у поля
   - calendar(), timeWheels(): календарь и колёса времени
   ===================================================================== */
const Spring = (() => {
  const soft = k => 2 * Math.sqrt(k);
  const S = (x, k = 400, c = 30) => ({ x, v: 0, t: x, k, c: REDUCED.matches ? soft(k) : c });
  const tune = (s, k, c) => { s.k = k; s.c = REDUCED.matches ? soft(k) : c; };
  const step = (s, dt) => { const a = -s.k * (s.x - s.t) - s.c * s.v; s.v += a * dt; s.x += s.v * dt; };
  const comps = new Set(); let last = 0, running = false;
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    for (let k = 0; k < 4; k++) comps.forEach(c => c.frame(dt / 4));
    comps.forEach(c => c.render());
    if (comps.size) requestAnimationFrame(loop); else running = false;
  }
  return {
    S, tune, step,
    add(c) { comps.add(c); if (!running) { running = true; last = performance.now(); requestAnimationFrame(loop); } },
    remove(c) { comps.delete(c); },
  };
})();
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- длительность: человеческий текст ---------- */
function durText(m) {
  if (m >= 1440) {
    const d = Math.floor(m / 1440), rest = m % 1440, dw = (d % 10 === 1 && d % 100 !== 11) ? 'день' : (d % 10 >= 2 && d % 10 <= 4 && (d % 100 < 10 || d % 100 >= 20)) ? 'дня' : 'дней';
    return `${d} ${dw}` + (rest ? ' ' + durText(rest) : '');
  }
  const hh = Math.floor(m / 60), mm = m % 60;
  const hw = n => (n % 10 === 1 && n % 100 !== 11) ? 'час' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 'часа' : 'часов';
  const mw = n => (n % 10 === 1 && n % 100 !== 11) ? 'минута' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 'минуты' : 'минут';
  if (!hh) return `${mm} ${mw(mm)}`;
  return `${hh} ${hw(hh)}` + (mm ? ` ${mm} ${mw(mm)}` : '');
}
const durShort = m => m < 60 ? m + 'м' : m % 60 ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : Math.floor(m / 60) + 'ч';

/* =====================================================================
   JELLY SLIDER
   ===================================================================== */
class JellySlider {
  constructor(root, opt) {
    this.o = Object.assign({ min: 5, max: 300, value: 60, knots: [[0, 5], [.2, 30], [.38, 60], [1, 300]], snaps: [], majors: [], label: v => v, short: v => v, onChange() {} }, opt);
    const T = { follow: [900, 50], bubble: [420, 22], release: [300, 14], glide: [420, 34] };
    this.T = T;
    root.classList.add('jelly');
    root.innerHTML = '';
    const el = c => h('div', { class: c });
    this.rail = el('j-rail'); this.fill = el('j-fill'); this.thumb = el('j-blob j-thumb'); this.drop = el('j-blob j-drop');
    this.dropLabel = el('j-label');
    this.hit = h('div', { class: 'j-hit', role: 'slider', tabindex: '0', 'aria-label': opt.aria || 'Значение', 'aria-valuemin': String(this.o.min), 'aria-valuemax': String(this.o.max) });
    this.rail.append(h('div', { class: 'j-track' }, this.fill), h('div', { class: 'j-goo' }, this.drop, this.thumb), this.dropLabel, this.hit);
    this.marks = el('j-marks'); this.nums = el('j-nums');
    root.append(this.rail, h('div', { class: 'j-ticks' }, this.marks, this.nums));
    this.markEls = this.o.snaps.map(v => { const m = h('i', { class: this.o.majors.some(x => x[0] === v) ? 'major' : '' }); m.dataset.v = v; this.marks.append(m); return m; });
    this.numEls = this.o.majors.map(([v, t]) => { const s = h('span', { text: t }); s.dataset.v = v; this.nums.append(s); return s; });

    this.R = 12; this.TR = 14; this.D = 18; this.OX = 40; this.OY = 80; this.CY = 16; this.RISE = -38;
    this.W = 0; this.value = this.o.value; this.reported = this.value;
    this.X = Spring.S(0, ...T.follow);
    this.DX = Spring.S(0, 260, 18);
    this.DY = Spring.S(this.CY, ...T.bubble);
    this.DS = Spring.S(.5, ...T.bubble);
    this.PS = Spring.S(1, 520, 16);
    this.dragging = false; this.hover = false; this.lifted = false; this.inSnap = null;

    const r = this.rail;
    r.addEventListener('pointerdown', e => {
      this.dragging = true; try { r.setPointerCapture(e.pointerId); } catch {}
      Spring.tune(this.X, ...T.follow); this.X.t = this.magnet(this.rubber(this.localX(e)));
      this.sync(); this.hit.focus({ preventScroll: true });
    });
    r.addEventListener('pointermove', e => { if (this.dragging) this.X.t = this.magnet(this.rubber(this.localX(e))); });
    const end = () => {
      if (!this.dragging) return;
      this.dragging = false; this.inSnap = null;
      Spring.tune(this.X, ...T.release);
      this.X.t = clampN(this.X.t, this.R, this.W - this.R);
      this.sync();
    };
    r.addEventListener('pointerup', end); r.addEventListener('pointercancel', end);
    r.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { this.hover = true; this.sync(); } });
    r.addEventListener('pointerleave', () => { this.hover = false; this.sync(); });
    this.hit.addEventListener('keydown', e => {
      const base = Math.round(this.toV(this.X.t));
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 30, PageDown: -30 }[e.key];
      const abs = { Home: this.o.min, End: this.o.max }[e.key];
      if (d === undefined && abs === undefined) return;
      e.preventDefault();
      this.set(abs !== undefined ? abs : clampN(base + d * (e.shiftKey ? 5 : 1), this.o.min, this.o.max), true);
      this.lifted = true; this.sync();
    });
    this.hit.addEventListener('focus', () => { if (this.hit.matches(':focus-visible')) { this.lifted = true; this.sync(); } });
    this.hit.addEventListener('blur', () => { this.lifted = false; this.sync(); });
    new ResizeObserver(() => {
      const w = this.rail.clientWidth; if (!w || w === this.W) return;
      this.W = w; const x = this.toX(this.value);
      this.X.x = this.X.t = this.DX.x = this.DX.t = x; this.X.v = this.DX.v = 0;
      this.placeTicks();
    }).observe(this.rail);
  }
  // нелинейная шкала: отрезки [доля ширины, значение]
  pToV(p) { const k = this.o.knots; p = clampN(p, 0, 1); for (let i = 1; i < k.length; i++) if (p <= k[i][0]) { const [p0, v0] = k[i - 1], [p1, v1] = k[i]; return v0 + (p - p0) / (p1 - p0) * (v1 - v0); } return k[k.length - 1][1]; }
  vToP(v) { const k = this.o.knots; v = clampN(v, this.o.min, this.o.max); for (let i = 1; i < k.length; i++) if (v <= k[i][1]) { const [p0, v0] = k[i - 1], [p1, v1] = k[i]; return p0 + (v - v0) / (v1 - v0) * (p1 - p0); } return 1; }
  span() { return Math.max(this.W - 2 * this.R, 1); }
  toX(v) { return this.R + this.vToP(v) * this.span(); }
  toV(x) { return this.pToV((x - this.R) / this.span()); }
  localX(e) { return e.clientX - this.rail.getBoundingClientRect().left; }
  rubber(x, d = 18) {
    const min = this.R, max = this.W - this.R;
    return x < min ? min - (1 - 1 / ((min - x) * .55 / d + 1)) * d : x > max ? max + (1 - 1 / ((x - max) * .55 / d + 1)) * d : x;
  }
  // примагничивание к явным отметкам
  magnet(x) {
    let hit = null;
    for (const s of this.o.snaps) { const sx = this.toX(s); if (Math.abs(x - sx) < 9) { hit = s; x = sx; break; } }
    if (hit !== null && hit !== this.inSnap) { try { navigator.vibrate && navigator.vibrate(6); } catch {} }
    this.inSnap = hit;
    return x;
  }
  placeTicks() {
    const pos = v => `calc(${this.R}px + (100% - ${2 * this.R}px) * ${this.vToP(v)})`;
    this.markEls.forEach(m => m.style.left = pos(+m.dataset.v));
    this.numEls.forEach(n => n.style.left = pos(+n.dataset.v));
  }
  set(v, animate) {
    v = clampN(Math.round(v), this.o.min, this.o.max);
    if (!this.W) { this.value = v; return; }
    if (animate) Spring.tune(this.X, ...this.T.glide);
    this.X.t = this.toX(v);
    if (!animate) { this.X.x = this.DX.x = this.X.t; this.X.v = this.DX.v = 0; }
    this.value = v; this.reported = v;
  }
  sync() {
    const up = this.dragging || this.lifted;
    this.DY.t = up ? this.CY + this.RISE : this.CY;
    this.DS.t = up ? 1 : .5;
    this.PS.t = this.dragging ? 1.16 : this.hover ? 1.08 : 1;
  }
  frame(dt) {
    this.DX.t = this.X.x;
    for (const s of [this.X, this.DX, this.DY, this.DS, this.PS]) Spring.step(s, dt);
  }
  render() {
    if (!this.W) return;
    const x = this.X.x, { TR, OX, OY, CY, D, R } = this;
    const target = Math.round(this.toV(clampN(this.X.t, R, this.W - R)));
    if (target !== this.reported) { this.reported = target; this.value = target; this.o.onChange(target); }
    const shown = Math.round(this.toV(clampN(x, R, this.W - R)));
    const st = 1 + Math.min(Math.abs(this.X.v) / 2400, .4);
    this.thumb.style.transform = `translate(${x - TR + OX}px,${CY - TR + OY}px) scale(${st * this.PS.x},${this.PS.x / st})`;
    const tilt = clampN((this.DX.x - x) * .9, -28, 28);
    const dTr = `translate(${this.DX.x - D}px,${this.DY.x - D}px) rotate(${tilt}deg) scale(${this.DS.x})`;
    this.drop.style.transform = `translate(${OX}px,${OY}px) ` + dTr;
    this.dropLabel.style.transform = dTr;
    this.dropLabel.style.opacity = clampN((this.DS.x - .7) / .25, 0, 1);
    this.dropLabel.textContent = this.o.short(shown);
    this.fill.style.width = clampN(x, 0, this.W) * clampN((x - R) / R, 0, 1) + 'px';
    this.hit.style.left = x - R + 'px';
    this.hit.setAttribute('aria-valuenow', String(shown));
    this.hit.setAttribute('aria-valuetext', this.o.label(shown));
    if (this.lit !== shown) { this.lit = shown; this.markEls.forEach(m => m.classList.toggle('on', +m.dataset.v <= shown)); this.numEls.forEach(n => n.classList.toggle('on', +n.dataset.v <= shown)); }
  }
}

/* =====================================================================
   ВСПЛЫВАЮЩЕЕ ОКНО У ПОЛЯ
   ===================================================================== */
const Pop = {
  el: null, anchor: null,
  open(anchor, content, cls) {
    if (this.anchor === anchor) { this.close(); return null; }
    this.close(true);
    this.anchor = anchor; anchor.setAttribute('aria-expanded', 'true'); anchor.classList.add('open');
    this.el = h('div', { class: 'picker glass-strong ' + (cls || ''), role: 'dialog' }, content);
    document.body.append(this.el);
    this.place();
    this.onDown = e => { if (!this.el.contains(e.target) && !anchor.contains(e.target)) this.close(); };
    this.onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); anchor.focus(); } };
    this.onMove = () => this.place();
    setTimeout(() => document.addEventListener('pointerdown', this.onDown, true));
    document.addEventListener('keydown', this.onKey, true);
    addEventListener('resize', this.onMove); document.addEventListener('scroll', this.onMove, true);
    return this.el;
  },
  place() {
    if (!this.el) return;
    const r = this.anchor.getBoundingClientRect(), w = this.el.offsetWidth, hh = this.el.offsetHeight;
    let top = r.bottom + 8;
    if (top + hh > innerHeight - 8) top = Math.max(8, r.top - hh - 8);
    this.el.style.left = clampN(r.left, 8, innerWidth - w - 8) + 'px';
    this.el.style.top = top + 'px';
    this.el.style.transformOrigin = top < r.top ? 'bottom left' : 'top left';
  },
  close(instant) {
    if (!this.el) return;
    const el = this.el; this.el = null;
    this.anchor.setAttribute('aria-expanded', 'false'); this.anchor.classList.remove('open'); this.anchor = null;
    document.removeEventListener('pointerdown', this.onDown, true); document.removeEventListener('keydown', this.onKey, true);
    removeEventListener('resize', this.onMove); document.removeEventListener('scroll', this.onMove, true);
    if (instant) { el.remove(); return; }
    el.classList.add('out'); setTimeout(() => el.remove(), 180);
  },
};

/* =====================================================================
   КАЛЕНДАРЬ
   ===================================================================== */
function calendar(selected, minDate, onPick) {
  const box = h('div', { class: 'cal' });
  let [y, m] = selected.split('-').map(Number); m--;
  const pad = n => String(n).padStart(2, '0');
  const iso = (yy, mm, dd) => `${yy}-${pad(mm + 1)}-${pad(dd)}`;
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const maxDate = addDays(minDate, 365);
  const monthName = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' });
  let dir = 0;
  function draw() {
    const first = new Date(Date.UTC(y, m, 1)), lead = (first.getUTCDay() + 6) % 7, days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const title = monthName.format(first);
    const prevOk = iso(y, m, 1) > minDate, nextOk = iso(y, m + 1, 1) <= maxDate;
    const head = h('div', { class: 'cal-head' },
      h('b', { text: title[0].toUpperCase() + title.slice(1) + ' ' + y }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Предыдущий месяц', disabled: !prevOk, onclick: () => { if (--m < 0) { m = 11; y--; } dir = -1; draw(); } }, svgIcon('back')),
      h('button', { type: 'button', class: 'icon-btn flip-x', 'aria-label': 'Следующий месяц', disabled: !nextOk, onclick: () => { if (++m > 11) { m = 0; y++; } dir = 1; draw(); } }, svgIcon('back')));
    const grid = h('div', { class: 'cal-grid' + (dir ? (dir > 0 ? ' from-r' : ' from-l') : '') });
    for (const w of ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']) grid.append(h('span', { class: 'cal-wd', text: w }));
    for (let i = 0; i < lead; i++) grid.append(h('span'));
    for (let d = 1; d <= days; d++) {
      const v = iso(y, m, d), off = v < minDate || v > maxDate;
      grid.append(h('button', {
        type: 'button', class: 'cal-day' + (v === selected ? ' sel' : '') + (v === minDate ? ' today' : '') + ((lead + d - 1) % 7 > 4 ? ' we' : ''),
        disabled: off, text: String(d), onclick: () => { selected = v; onPick(v); draw(); },
      }));
    }
    const quick = h('div', { class: 'cal-quick' },
      [['Сегодня', 0], ['Завтра', 1], ['Через неделю', 7]].map(([t, n]) => {
        const v = addDays(minDate, n);
        return h('button', { type: 'button', class: 'chip-btn' + (v === selected ? ' on' : ''), text: t, onclick: () => { selected = v; [y, m] = v.split('-').map(Number); m--; onPick(v); dir = 0; draw(); } });
      }));
    box.replaceChildren(head, grid, quick);
    paintIcons(box);
  }
  draw();
  return box;
}

/* =====================================================================
   КОЛЁСА ВРЕМЕНИ (как в iOS)
   ===================================================================== */
function timeWheels(value, minuteStep, onChange, title) {
  const ITEM = 40;
  let [hh, mm] = value.split(':').map(Number);
  const box = h('div', { class: 'wheels-box' });
  const wrap = h('div', { class: 'wheels' }, h('div', { class: 'wheel-band', 'aria-hidden': 'true' }));
  const mins = []; for (let i = 0; i < 60; i += minuteStep) mins.push(i);
  if (!mins.includes(mm)) mins.push(mm), mins.sort((a, b) => a - b);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const make = (vals, cur, set, label) => {
    const col = h('div', { class: 'wheel', tabindex: '0', role: 'listbox', 'aria-label': label });
    const items = vals.map(v => h('div', { class: 'wheel-item', role: 'option', text: String(v).padStart(2, '0'), onclick: () => col.scrollTo({ top: vals.indexOf(v) * ITEM, behavior: 'smooth' }) }));
    col.append(h('div', { class: 'wheel-pad' }), ...items, h('div', { class: 'wheel-pad' }));
    let t = 0, idx = vals.indexOf(cur);
    const mark = () => {
      const i = clampN(Math.round(col.scrollTop / ITEM), 0, vals.length - 1);
      items.forEach((it, k) => { const d = Math.abs(col.scrollTop / ITEM - k); it.style.opacity = String(clampN(1 - d * .28, .18, 1)); it.style.transform = `scale(${clampN(1.12 - d * .1, .8, 1.12)})`; it.classList.toggle('sel', k === i); });
      return i;
    };
    col.addEventListener('scroll', () => {
      requestAnimationFrame(mark);
      clearTimeout(t); t = setTimeout(() => { if (!col.isConnected || col.closest('.picker.out')) return; const i = mark(); if (i !== idx) { idx = i; set(vals[i]); try { navigator.vibrate && navigator.vibrate(4); } catch {} } }, 90);
    }, { passive: true });
    col.addEventListener('keydown', e => {
      const d = { ArrowDown: 1, ArrowUp: -1 }[e.key]; if (!d) return;
      e.preventDefault(); col.scrollTo({ top: clampN(idx + d, 0, vals.length - 1) * ITEM, behavior: 'smooth' });
    });
    col._init = () => { col.scrollTop = idx * ITEM; mark(); };
    col._setVal = v => { const i = vals.indexOf(v); if (i < 0 || i === idx) return; idx = i; col.scrollTop = i * ITEM; mark(); };
    return col;
  };
  const hc = make(hours, hh, v => { hh = v; onChange(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`); }, 'Часы');
  const mc = make(mins, mm, v => { mm = v; onChange(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`); }, 'Минуты');
  wrap.append(hc, h('span', { class: 'wheel-colon', text: ':' }), mc);
  box.append(h('div', { class: 'wheels-title', text: title }), wrap, h('button', { type: 'button', class: 'btn btn-primary btn-sm wheels-done', text: 'Готово', onclick: () => Pop.close() }));
  box._init = () => { hc._init(); mc._init(); };
  box._set = v => { const [a, b] = v.split(':').map(Number); hh = a; mm = b; hc._setVal(a); mc._setVal(b); };
  return box;
}
