'use strict';
/* =====================================================================
   КИНО ВМЕСТЕ — кинозал прямо внутри звонка.
   Открыл один — кинозал открывается у всех, звонок не прерывается.
   Фильм каждый загружает сам (ссылка или свой файл), по сети идут
   только «плей», «пауза» и время. Общее состояние хранит hub комнаты,
   поэтому кинозал переживает уход любого участника.
   Звук фильма проигрывается через WebRTC-петлю — эхоподавление
   браузера знает его и вычитает из микрофона.
   Совместим с расширением «Сеанс» (подставляет Referer/CORS для потоков).
   ===================================================================== */

/* ---------- общее состояние (его же использует hub) ---------- */
const Cine = {
  KINDS: ['hls', 'video', 'file'],
  blank() { return { open: false, url: null, kind: null, title: '', playing: false, pos: 0, at: Date.now(), v: 0, by: null }; },
  urlOk(u, k) {
    if (typeof u !== 'string' || u.length > 16000) return false;
    if (k === 'file') return /^file:[^\n\r]{1,300}:\d{1,15}$/.test(u);
    if (!/^https:\/\/[^\s]+$/i.test(u)) return false;
    try { return new URL(u).protocol === 'https:'; } catch { return false; }
  },
  clean(x) {
    if (!x || typeof x !== 'object') return null;
    const o = Cine.blank();
    o.open = !!x.open; o.v = Math.max(0, +x.v || 0); o.at = +x.at || 0;
    o.pos = Math.max(0, Math.min(1e6, +x.pos || 0)); o.playing = !!x.playing;
    o.by = typeof x.by === 'string' ? x.by.slice(0, 64) : null;
    if (o.open && Cine.KINDS.includes(x.kind) && Cine.urlOk(x.url, x.kind)) { o.url = x.url; o.kind = x.kind; o.title = String(x.title || '').slice(0, 120); }
    else o.playing = false;
    return o;
  },
  // новый hub подхватывает кинозал у прежнего: время пересчитывается на «сейчас»
  hubInit(prev) {
    const c = Cine.clean(prev);
    if (!c) return Cine.blank();
    if (!c.open) return { ...Cine.blank(), v: c.v + 1 };
    if (c.playing) c.pos = Math.max(0, c.pos + Math.max(0, hubNow() - c.at) / 1000);
    c.at = Date.now(); c.v += 1;
    return c;
  },
  hubAct(c, a, id) {
    if (!a || typeof a !== 'object') return false;
    const now = Date.now(), cur = c.playing ? c.pos + (now - c.at) / 1000 : c.pos;
    const pos = typeof a.pos === 'number' && Number.isFinite(a.pos) ? Math.max(0, Math.min(1e6, a.pos)) : cur;
    switch (a.type) {
      case 'open': if (c.open) return false; Object.assign(c, Cine.blank(), { open: true, by: id, v: c.v }); break;
      case 'close': if (!c.open) return false; Object.assign(c, Cine.blank(), { v: c.v }); break;
      case 'load': {
        const k = String(a.kind), u = String(a.url || '');
        if (!c.open || !Cine.KINDS.includes(k) || !Cine.urlOk(u, k)) return false;
        Object.assign(c, { url: u, kind: k, title: String(a.title || '').slice(0, 120), pos: 0, playing: false, by: id });
        break;
      }
      case 'play': if (!c.url) return false; c.playing = true; c.pos = pos; break;
      case 'pause': if (!c.url) return false; c.playing = false; c.pos = pos; break;
      case 'seek': if (!c.url) return false; c.pos = pos; break;
      default: return false;
    }
    c.at = now; c.v++;
    return true;
  },
};

/* ---------- субтитры: разбор SRT / WebVTT / ASS ---------- */
const SUB_LANGS = { ru: 'Русский', en: 'English', uk: 'Українська', be: 'Беларуская', kk: 'Қазақша', es: 'Español', de: 'Deutsch', fr: 'Français', it: 'Italiano', pt: 'Português', pl: 'Polski', tr: 'Türkçe', ja: '日本語', ko: '한국어', zh: '中文', uz: 'Oʻzbekcha', ka: 'ქართული', hy: 'Հայերեն', az: 'Azərbaycan' };
const SUB_LANG3 = { rus: 'ru', eng: 'en', ukr: 'uk', bel: 'be', kaz: 'kk', spa: 'es', ger: 'de', deu: 'de', fre: 'fr', fra: 'fr', ita: 'it', por: 'pt', pol: 'pl', tur: 'tr', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', uzb: 'uz', geo: 'ka', kat: 'ka', arm: 'hy', hye: 'hy', aze: 'az' };
const SUB_WORDS = { russian: 'ru', english: 'en', ukrainian: 'uk', spanish: 'es', german: 'de', french: 'fr', italian: 'it', japanese: 'ja', korean: 'ko', chinese: 'zh', 'русский': 'ru', 'русские': 'ru', 'английский': 'en', 'английские': 'en', 'украинский': 'uk' };
function normLang(code) { if (!code) return ''; const c = String(code).toLowerCase().trim().split(/[-_\s]/)[0]; return SUB_LANGS[c] ? c : SUB_LANG3[c] || SUB_WORDS[c] || ''; }
function langName(code, fb) { return SUB_LANGS[code] || fb || (code ? code.toUpperCase() : ''); }
function langFromName(n) {
  let p = String(n || ''); try { const u = new URL(p); p = decodeURIComponent(u.pathname + u.search); } catch {}
  for (const t of p.toLowerCase().split(/[^a-zа-яё]+/i).filter(Boolean).reverse()) {
    const l = SUB_WORDS[t] || SUB_LANG3[t] || (t.length === 2 && SUB_LANGS[t] && !['it', 'ka', 'be'].includes(t) ? t : '');
    if (l) return l;
  }
  return '';
}
function langFromText(t) {
  const s = t.slice(0, 20000), cyr = (s.match(/[а-яё]/gi) || []).length, lat = (s.match(/[a-z]/gi) || []).length;
  if (cyr > lat) return (s.match(/[іїєґ]/gi) || []).length > cyr * 0.01 ? 'uk' : 'ru';
  if (lat > 50 && (s.match(/\b(the|you|and|what|is)\b/gi) || []).length > 10) return 'en';
  return '';
}
function decodeText(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(buf);
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { try { return new TextDecoder('windows-1251').decode(buf); } catch { return new TextDecoder().decode(buf); } }
}
function subTime(str) {
  const m = String(str).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?/); if (!m) return NaN;
  return (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + (m[4] ? +('0.' + m[4].padEnd(3, '0')) : 0);
}
// оставляем только <i>, <b>, <u> и переносы — дальше это превращается в DOM через textContent
function cueText(t) {
  t = t.replace(/\{\\[^}]*\}/g, '').replace(/\\N/gi, '\n').replace(/\\h/g, ' ');
  return t.replace(/<(?!\/?(i|b|u)>)[^>]*>/gi, '').trim();
}
function parseSubs(text) {
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const cues = [];
  if (/^\[Script Info\]/mi.test(text) || /^Dialogue:/m.test(text)) {
    let fmtA = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'], inEv = false;
    for (const l of text.split('\n')) {
      if (/^\[events\]/i.test(l)) { inEv = true; continue; }
      if (/^\[/.test(l)) { inEv = false; continue; }
      if (inEv && /^Format:/i.test(l)) fmtA = l.slice(7).split(',').map(x => x.trim().toLowerCase());
      if (!/^Dialogue:/i.test(l)) continue;
      const parts = l.slice(9).split(','), ti = fmtA.indexOf('text');
      const f = parts.slice(0, ti); f.push(parts.slice(ti).join(','));
      const s = subTime(f[fmtA.indexOf('start')]), e = subTime(f[fmtA.indexOf('end')]), x = cueText(f[ti] || '');
      if (x && e > s) cues.push({ s, e, x });
    }
    return { cues: cues.sort((a, b) => a.s - b.s), map: null };
  }
  let map = null; const mm = text.match(/X-TIMESTAMP-MAP=([^\n]+)/);
  if (mm) { const o = {}; mm[1].split(',').forEach(p => { const k = p.indexOf(':'); o[p.slice(0, k).trim().toUpperCase()] = p.slice(k + 1).trim(); }); map = { mpegts: +o.MPEGTS || 0, local: subTime(o.LOCAL || '0:00') || 0 }; }
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n'), i = lines.findIndex(l => l.includes('-->')); if (i < 0) continue;
    const [a, b] = lines[i].split('-->'), s = subTime(a), e = subTime(b), x = cueText(lines.slice(i + 1).join('\n'));
    if (x && Number.isFinite(s) && e > s) cues.push({ s, e, x });
  }
  return { cues: cues.sort((a, b) => a.s - b.s), map };
}
function cueNodes(x) {
  const out = h('span'); let cur = out; const stack = [];
  for (const part of x.split(/(<\/?[ibu]>|\n)/i)) {
    if (!part) continue;
    if (part === '\n') { cur.append(h('br')); continue; }
    const m = part.match(/^<(\/?)([ibu])>$/i);
    if (m) {
      if (!m[1]) { const n = h(m[2].toLowerCase()); cur.append(n); stack.push(cur); cur = n; }
      else if (stack.length) cur = stack.pop();
      continue;
    }
    cur.append(document.createTextNode(part));
  }
  return out;
}

const Cinema = (() => {
  const SUB_COLORS = ['#ffffff', '#ffe17a', '#7fe3ff', '#a6f08a'];
  let st = null, visible = false, built = false, seq = 0, toldEcho = false;
  const peers = {};                 // кто на какой секунде
  const E = {};                     // элементы
  let video = null;
  const P = {
    key: null, kind: null, hls: null, ready: false, blocked: false, buffering: false, err: null, need: null,
    url: null, cors: false, corsFailed: false, hlsRetried: false, mediaRecovered: false,
    vol: Math.max(0, Math.min(1, +ls.get('cineVol', 1))), muted: false, duck: 1, duckOn: ls.get('cineDuck', true), file: null,
  };
  const EXT = { present: !!document.documentElement.dataset.seansExt, version: null, waits: {}, pending: null };

  const expectedPos = s => s.playing ? s.pos + Math.max(0, hubNow() - s.at) / 1000 : s.pos;
  const vtime = () => (video && video.currentTime) || 0;
  const vdur = () => video && Number.isFinite(video.duration) ? video.duration : 0;
  const fmt = t => { t = Math.max(0, Math.floor(t || 0)); const hh = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (hh ? hh + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  const fileName = u => String(u).replace(/^file:/, '').replace(/:\d+$/, '');
  const isOn = () => !!(st && st.open);
  const hasFilm = () => !!(st && st.open && st.url);

  /* ---------- ссылки из расширения: адрес#seans-ref=<страница>&seans-subs=<[[адрес, язык, название]]> ---------- */
  function splitRef(url) {
    url = String(url || '');
    const i = url.search(/#seans-(ref|subs)=/);
    if (i < 0) return { clean: url, ref: null, subs: [] };
    const q = new URLSearchParams(url.slice(i + 1));
    let subs = []; try { subs = JSON.parse(q.get('seans-subs') || '[]'); } catch {}
    let ref = q.get('seans-ref') || null; if (ref && !/^https?:\/\//i.test(ref)) ref = null;
    return { clean: url.slice(0, i), ref, subs: Array.isArray(subs) ? subs.filter(x => Array.isArray(x) && /^https:\/\//i.test(x[0])).slice(0, 30) : [] };
  }
  function extPrepare(ref) {
    if (!EXT.present) return Promise.resolve(false);
    return new Promise(res => {
      const id = randStr(12, 'abcdefghijklmnopqrstuvwxyz0123456789'); EXT.waits[id] = res;
      window.postMessage({ source: 'seans-page', type: 'prepare', ref: ref || null, id }, location.origin);
      setTimeout(() => { if (EXT.waits[id]) { delete EXT.waits[id]; res(false); } }, 1500);
    });
  }
  window.addEventListener('message', e => {
    if (e.source !== window || e.origin !== location.origin || !e.data || e.data.source !== 'seans-ext') return;
    const d = e.data;
    if (d.type === 'hello') { EXT.present = true; EXT.version = String(d.version || '').slice(0, 16); extUi(); }
    if (d.type === 'prepared' && EXT.waits[d.id]) { EXT.waits[d.id](!!d.ok); delete EXT.waits[d.id]; }
    if (d.type === 'load' && typeof d.url === 'string') {
      const url = d.url.slice(0, 16000), title = String(d.title || '').slice(0, 120);
      if (S.inCall) offerLink(url, title);
      else { EXT.pending = { url, title }; toast('Зайдите в звонок — ссылка из «Сеанса» подставится в кинозал', { icon: 'film', ms: 5000 }); }
    }
  });
  function offerLink(url, title) {
    if (!isOn()) send({ t: 'cine', a: { type: 'open' } });
    visible = true; render();
    openSrc(url, title ? title.replace(/\s*[—|-]\s*(смотреть|HDrezka|Kinogo).*$/i, '').slice(0, 80) : '');
    toast('Ссылка из «Сеанса» — нажмите «Включить у всех»', { icon: 'film' });
  }
  function extUi() {
    $('#cineExtOk').classList.toggle('hidden', !EXT.present);
    $('#cineExtLink').classList.toggle('hidden', EXT.present);
  }

  /* ---------- разметка кинозала ---------- */
  const ib = (icon, label, fn, cls) => h('button', { class: 'cine-btn' + (cls ? ' ' + cls : ''), type: 'button', 'aria-label': label, title: label, onclick: fn }, svgIcon(icon));
  function build() {
    if (built) return; built = true;
    E.title = h('h3', { class: 'cine-title', text: 'Кино вместе' });
    E.syncDot = h('span', { class: 'dot' }); E.syncTxt = h('span');
    E.sync = h('span', { class: 'cine-sync hidden' }, E.syncDot, E.syncTxt);
    E.change = h('button', { class: 'btn btn-glass btn-sm', type: 'button', onclick: () => openSrc() }, svgIcon('plus'), h('span', { text: 'Фильм' }));
    const head = h('div', { class: 'cine-head' }, svgIcon('film'), h('div', { class: 'cine-tt' }, E.title, E.sync), E.change,
      h('button', { class: 'icon-btn', type: 'button', title: 'Свернуть — звонок и фильм продолжатся', 'aria-label': 'Свернуть кинозал', onclick: () => hide() }, svgIcon('minimize')),
      h('button', { class: 'icon-btn', type: 'button', title: 'Закрыть кинозал для всех', 'aria-label': 'Закрыть кинозал для всех', onclick: () => { if (confirm('Закрыть кинозал для всех?')) act('close'); } }, svgIcon('close')));

    video = h('video', { class: 'cine-video', playsinline: true, preload: 'auto' }); video.playsInline = true;
    E.subs = h('div', { class: 'cine-subs', 'aria-live': 'off' });
    E.empty = h('div', { class: 'cine-empty' },
      h('div', { class: 'cine-empty-ico' }, svgIcon('film')),
      h('h2', { class: 'title', text: 'Что смотрим?' }),
      h('p', { class: 'muted', text: 'Вставьте ссылку на фильм или выберите файл — он включится у всех. Звонок продолжается.' }),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openSrc() }, svgIcon('plus'), h('span', { text: 'Добавить фильм' })));
    E.msg = h('div', { class: 'cine-msg hidden' });
    E.spin = h('div', { class: 'cine-spin hidden' }, h('span', { class: 'spinner' }));

    // панель плеера
    E.fill = h('i', { class: 'cs-fill' }); E.buf = h('i', { class: 'cs-buf' }); E.knob = h('i', { class: 'cs-knob' });
    E.hover = h('span', { class: 'cs-hover hidden' });
    E.seek = h('div', { class: 'cine-seek', role: 'slider', 'aria-label': 'Перемотка', tabindex: '-1' }, h('div', { class: 'cs-track' }, E.buf, E.fill), E.knob, E.hover);
    E.play = ib('play', 'Смотреть', () => togglePlay(), 'cine-play');
    E.time = h('span', { class: 'cine-time tnum', text: '0:00' });
    E.mute = ib('volume', 'Звук фильма', () => { P.muted = !P.muted; applyVol(); ui(); });
    E.vol = h('input', { class: 'cine-vol', type: 'range', min: '0', max: '1', step: '0.02', 'aria-label': 'Громкость фильма' });
    E.vol.value = P.vol;
    E.vol.addEventListener('input', () => { P.vol = +E.vol.value; P.muted = false; ls.set('cineVol', P.vol); applyVol(); ui(); });
    E.cc = h('button', { class: 'cine-btn cine-cc', type: 'button', 'aria-label': 'Субтитры', title: 'Субтитры (C)', text: 'CC', onclick: e => { e.stopPropagation(); popMenu('cc'); } });
    E.opts = ib('sliders', 'Качество, озвучка, звук', e => { e.stopPropagation(); popMenu('opts'); });
    E.fs = ib('expand', 'Во весь экран (F)', () => toggleFs());
    E.pop = h('div', { class: 'cine-pop glass-strong hidden' });
    E.pop.addEventListener('click', e => e.stopPropagation());
    E.bar = h('div', { class: 'cine-bar' }, E.seek,
      h('div', { class: 'cine-row' }, E.play, ib('back10', 'Назад 10 с', () => hasFilm() && act('seek', { pos: vtime() - 10 })), ib('fwd10', 'Вперёд 10 с', () => hasFilm() && act('seek', { pos: vtime() + 10 })),
        E.time, h('span', { class: 'spacer' }), h('span', { class: 'cine-volw' }, E.mute, E.vol), E.cc, E.opts, E.fs));
    E.stage = h('div', { class: 'cine-stage' }, video, E.subs, E.empty, E.msg, E.spin, E.bar, E.pop);
    $('#cineLayer').replaceChildren(h('div', { class: 'cine-card glass-strong' }, head, E.stage));

    // события плеера
    video.addEventListener('click', () => togglePlay());
    video.addEventListener('dblclick', () => toggleFs());
    video.addEventListener('waiting', () => { P.buffering = true; ui(); });
    ['playing', 'canplay', 'pause', 'seeked'].forEach(ev => video.addEventListener(ev, () => { P.buffering = false; ui(); }));
    video.addEventListener('playing', () => { Loop.maybeStart(); echoHint(); });
    video.addEventListener('loadedmetadata', () => ui());
    video.addEventListener('error', onVideoError);
    // перемотка
    let drag = null;
    const posAt = e => { const r = E.seek.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * vdur(); };
    E.seek.addEventListener('pointermove', e => {
      if (!vdur()) return;
      const t = posAt(e), r = E.seek.getBoundingClientRect();
      E.hover.textContent = fmt(t); E.hover.style.left = (e.clientX - r.left) + 'px'; E.hover.classList.remove('hidden');
      if (drag !== null) { drag = t; drawSeek(t); }
    });
    E.seek.addEventListener('pointerleave', () => E.hover.classList.add('hidden'));
    E.seek.addEventListener('pointerdown', e => { if (!vdur()) return; E.seek.setPointerCapture(e.pointerId); drag = posAt(e); drawSeek(drag); E.seek.classList.add('drag'); });
    const up = e => { if (drag === null) return; const t = posAt(e); drag = null; E.seek.classList.remove('drag'); act('seek', { pos: t }); };
    E.seek.addEventListener('pointerup', up); E.seek.addEventListener('pointercancel', () => { drag = null; E.seek.classList.remove('drag'); });
    E.seekDrag = () => drag !== null;
    // панель прячется, пока фильм идёт и мышь не двигается
    let idleT = 0;
    const wake = () => { E.stage.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => { if (st && st.playing && E.pop.classList.contains('hidden') && !E.seekDrag()) E.stage.classList.add('idle'); }, 2800); };
    ['pointermove', 'pointerdown'].forEach(ev => E.stage.addEventListener(ev, wake, { passive: true }));
    // субтитры перетаскиванием файла на экран
    const isFile = e => [...(e.dataTransfer && e.dataTransfer.items || [])].some(i => i.kind === 'file') && hasFilm();
    E.stage.addEventListener('dragover', e => { if (!isFile(e)) return; e.preventDefault(); E.stage.classList.add('drop'); });
    E.stage.addEventListener('dragleave', e => { if (!E.stage.contains(e.relatedTarget)) E.stage.classList.remove('drop'); });
    E.stage.addEventListener('drop', e => {
      E.stage.classList.remove('drop');
      const fs = [...(e.dataTransfer && e.dataTransfer.files || [])].filter(f => /\.(srt|vtt|webvtt|ass|ssa)$/i.test(f.name));
      if (!fs.length) return; e.preventDefault(); Subs.addFiles(fs);
    });
    new ResizeObserver(() => E.stage.style.setProperty('--sub-px', Math.max(14, Math.min(60, E.stage.clientHeight * 0.05)) + 'px')).observe(E.stage);
    document.addEventListener('click', e => { if (!e.target.closest('.cine-pop')) closePop(); });
    paintIcons($('#cineLayer'));
  }

  /* ---------- видимость ---------- */
  function render() {
    const on = isOn(), want = on && visible && S.inCall;
    const pill = $('#cinePill');
    pill.classList.toggle('hidden', !on || want);
    if (on) $('#cinePillText').textContent = !st.url ? 'Кино' : st.playing ? 'Кино · идёт' : 'Кино · пауза';
    if (want) build();
    $('#cineLayer').classList.toggle('hidden', !want);
    document.body.classList.toggle('cine-on', want);
    if (want && typeof Games !== 'undefined') Games.hide();
    if (L.cine !== want) { L.cine = want; layout(); }
    if (built) ui();
  }
  function hide() { if (visible) { visible = false; closePop(); render(); } }
  function show() { if (isOn()) { visible = true; render(); } }
  function toggle() {
    if (!S.inCall) return;
    if (!isOn()) { visible = true; if (!send({ t: 'cine', a: { type: 'open' } })) toast('Нет связи с комнатой…'); return; }
    visible ? hide() : show();
  }

  /* ---------- состояние от hub ---------- */
  function onState(c, meta = {}) {
    if (!c) c = Cine.blank();
    if (meta.room && st && c.v <= st.v) return;           // в обновлениях комнаты — только если пропустили что-то
    const prev = st; st = c;
    const other = meta.from && meta.from !== me.id, who = other ? cleanName(meta.name) : '';
    if (!c.open) {
      if (prev && prev.open && other && meta.a === 'close') toast(`${who} закрыл(а) кинозал`, { icon: 'film' });
      closeLocal(); return;
    }
    if (!prev || !prev.open) {
      visible = true;
      if (other && meta.a === 'open') { toast(`${who} открывает кинозал`, { icon: 'film' }); chime(true); }
      if (EXT.pending) { const p = EXT.pending; EXT.pending = null; setTimeout(() => offerLink(p.url, p.title), 700); }
    }
    if (other) {
      const verb = { load: `включил(а) «${c.title || 'фильм'}»`, play: 'продолжил(а) просмотр', pause: 'поставил(а) на паузу', seek: 'перемотал(а) на ' + fmt(c.pos) }[meta.a];
      if (verb) toast(`${who} ${verb}`, { icon: 'film' });
      if (meta.a === 'load' && !visible) { visible = true; }
    }
    render();
    applyState(!!meta.welcome || meta.a === 'load' || (meta.a === 'seek' && other));
  }
  function onPos(m) {
    if (!m || typeof m.id !== 'string' || m.id === me.id) return;
    peers[m.id] = { p: typeof m.p === 'number' && Number.isFinite(m.p) ? m.p : null, s: String(m.s || ''), at: +m.at || 0, got: Date.now() };
  }

  function act(type, extra = {}) {
    if (!isOn()) return;
    if (type === 'play' || type === 'pause' || type === 'seek') {
      if (!st.url) return;
      const s = { ...st, at: hubNow() }, cur = P.ready ? vtime() : expectedPos(st);
      if (type === 'play') { s.playing = true; s.pos = typeof extra.pos === 'number' ? extra.pos : cur; }
      if (type === 'pause') { s.playing = false; s.pos = typeof extra.pos === 'number' ? extra.pos : cur; }
      if (type === 'seek') s.pos = Math.max(0, Math.min(extra.pos, vdur() || extra.pos));
      st = s; applyState(type === 'seek');
      extra = { ...extra, pos: s.pos };
    }
    if (!send({ t: 'cine', a: { type, ...extra } })) toast('Нет связи с комнатой…');
  }
  function togglePlay() { if (!hasFilm()) return openSrc(); if (P.need || P.err) return; act(st.playing ? 'pause' : 'play'); }

  /* ---------- плеер ---------- */
  function resetPlayer() {
    if (P.hls) { try { P.hls.destroy(); } catch {} P.hls = null; }
    Loop.stop();
    if (video) { video.pause(); video.removeAttribute('src'); video.removeAttribute('crossorigin'); video.load(); video.playbackRate = 1; }
    Object.assign(P, { ready: false, blocked: false, buffering: false, err: null, need: null, url: null, cors: false, corsFailed: false, hlsRetried: false, mediaRecovered: false });
  }
  async function loadSource(s) {
    const key = s.kind + '|' + s.url;
    if (P.key === key) return;
    resetPlayer(); P.key = key; P.kind = s.kind;
    const { clean, ref, subs } = splitRef(s.url);
    const prep = s.kind === 'file' ? Promise.resolve() : extPrepare(ref);
    Subs.reset(s.url, subs, prep);
    if (s.kind === 'file') {
      if (P.file && P.file.key === s.url) setSrc(P.file.url, false);
      else { P.need = fileName(s.url); ui(); return; }
    } else {
      await prep; if (P.key !== key) return;
      if (s.kind === 'hls' && window.Hls && Hls.isSupported()) startHls(clean);
      else setSrc(clean, true);
    }
    await waitMeta();
  }
  function setSrc(url, cors) {
    P.url = url; P.cors = !!cors;
    if (cors) video.crossOrigin = 'anonymous'; else video.removeAttribute('crossorigin');
    video.src = url;
  }
  function startHls(url) {
    P.url = url;
    const hl = P.hls = new Hls({ enableWorker: false, maxBufferLength: 60, xhrSetup: x => { x.withCredentials = false; } });
    hl.subtitleDisplay = false;
    hl.on(Hls.Events.MANIFEST_PARSED, () => { applyAudioPref(); Subs.fromHls(); ui(); });
    hl.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => Subs.fromHls());
    hl.on(Hls.Events.INIT_PTS_FOUND, (e, d) => Subs.setPTS(d));
    hl.on(Hls.Events.LEVEL_SWITCHED, () => ui());
    hl.on(Hls.Events.ERROR, (e, d) => {
      if (!d.fatal || P.hls !== hl) return;
      console.warn('hls', d.type, d.details);
      if (d.type === 'mediaError' && !P.mediaRecovered) { P.mediaRecovered = true; hl.recoverMediaError(); return; }
      if (d.type === 'networkError' && !P.hlsRetried && video.canPlayType('application/vnd.apple.mpegurl')) {
        P.hlsRetried = true; hl.destroy(); P.hls = null; setSrc(url, true); return;
      }
      showErr(`Поток не воспроизводится (${d.details || d.type}). Возможно, ссылка устарела — достаньте её заново.`);
    });
    hl.loadSource(url); hl.attachMedia(video);
  }
  function waitMeta() {
    return new Promise(res => {
      if (video.readyState >= 1) { P.ready = true; return res(); }
      const key = P.key, ok = () => { done(); if (P.key === key) P.ready = true; res(); };
      const done = () => { video.removeEventListener('loadedmetadata', ok); clearInterval(t); };
      // ошибки разбирает onVideoError (в том числе повтор без CORS) — здесь ждём либо метаданные, либо явную ошибку
      const t = setInterval(() => { if (P.err || P.key !== key) { done(); res(); } }, 300);
      video.addEventListener('loadedmetadata', ok);
    });
  }
  function onVideoError() {
    if (!P.key || !video.getAttribute('src') || P.hls) return;
    // сервер без CORS: смотрим без него (звук тогда идёт мимо петли эхоподавления)
    if (P.cors && !P.corsFailed && P.url) { P.corsFailed = true; setSrc(P.url, false); return; }
    const why = { 1: 'загрузка прервана', 2: 'ошибка сети', 3: 'не удалось декодировать видео', 4: 'сервер не отдал видео или формат не поддерживается' }[video.error && video.error.code] || 'неизвестная ошибка';
    showErr(`Причина: ${why}. Ссылка могла устареть или быть привязана к другому устройству — вставьте свою ссылку на тот же фильм или выберите файл.`);
  }
  function showErr(text) {
    if (hasFilm() && splitRef(st.url).ref && !EXT.present) text += ' Этот сайт отдаёт видео только «своим» — поставьте расширение «Сеанс», оно это обходит.';
    P.err = text; ui();
  }
  async function applyState(force) {
    const my = ++seq;
    if (!isOn() || !built) return;
    if (!st.url) { if (P.key) { resetPlayer(); P.key = null; Subs.clear(); } ui(); return; }
    await loadSource(st);
    if (my !== seq || !P.ready || !hasFilm()) { ui(); return; }
    const target = expectedPos(st);
    if (force || Math.abs(vtime() - target) > (st.playing ? 1 : 0.3)) { try { video.currentTime = target; } catch {} }
    if (st.playing) { if (video.paused) tryPlay(); }
    else if (!video.paused) video.pause();
    applyVol(); ui();
  }
  async function tryPlay() {
    try { await video.play(); P.blocked = false; }
    catch (e) { if (e && e.name === 'NotAllowedError') P.blocked = true; }
    ui();
  }
  // раз в секунду мягко подтягиваем всех к общему времени
  setInterval(() => {
    if (!hasFilm() || !P.ready || P.blocked || P.err || !video) return;
    const exp = expectedPos(st), diff = exp - vtime();
    if (st.playing) {
      if (video.paused && !video.ended) { tryPlay(); return; }
      if (Math.abs(diff) > 2) { try { video.currentTime = exp; } catch {} video.playbackRate = 1; }
      else if (Math.abs(diff) > 0.15) video.playbackRate = 1 + Math.max(-0.08, Math.min(0.08, diff * 0.4));
      else if (video.playbackRate !== 1) video.playbackRate = 1;
    } else {
      if (!video.paused) video.pause();
      if (Math.abs(diff) > 0.5) { try { video.currentTime = exp; } catch {} }
    }
  }, 1000);

  /* ---------- громкость, приглушение, эхо ---------- */
  function applyVol() {
    if (!video) return;
    const v = P.muted ? 0 : Math.min(1, P.vol * P.duck);
    if (Loop.active) Loop.setGain(v); else video.volume = v;
  }
  setInterval(() => {
    const target = P.duckOn && M.talking && hasFilm() ? 0.35 : 1;
    const next = P.duck + (target - P.duck) * (target < P.duck ? 0.45 : 0.18);
    const d = Math.abs(next - target) < 0.01 ? target : next;
    if (d !== P.duck) { P.duck = d; applyVol(); }
  }, 100);
  function echoHint() {
    setTimeout(() => {
      if (toldEcho || Loop.active || !hasFilm() || !st.playing || !micLive()) return;
      toldEcho = true;
      toast('Звук этого фильма браузер не может вычесть из микрофона — лучше смотреть в наушниках', { icon: 'speaker', ms: 6000 });
    }, 3500);
  }
  /* Петля: звук фильма → WebRTC → <audio>. Так эхоподавление браузера
     считает его «звуком собеседника» и убирает из микрофона.
     Работает для файлов, HLS и ссылок, где сервер разрешает CORS. */
  const Loop = {
    active: false, trying: false, gain: null, pcs: [], cap: null, src: null,
    canUse() { return P.kind === 'file' || !!P.hls || (P.cors && !P.corsFailed); },
    async maybeStart() {
      if (this.active || this.trying || !M.ctx || !this.canUse()) return;
      const cap = video.captureStream ? video.captureStream() : video.mozCaptureStream ? video.mozCaptureStream() : null;
      if (!cap || !cap.getAudioTracks().length) return;
      this.trying = true;
      try {
        const ctx = M.ctx; try { await ctx.resume(); } catch {}
        this.cap = cap;
        this.src = ctx.createMediaStreamSource(new MediaStream(cap.getAudioTracks()));
        this.gain = ctx.createGain(); const dest = ctx.createMediaStreamDestination();
        this.src.connect(this.gain).connect(dest);
        const a = new RTCPeerConnection(), b = new RTCPeerConnection(); this.pcs = [a, b];
        a.onicecandidate = e => e.candidate && b.addIceCandidate(e.candidate).catch(() => {});
        b.onicecandidate = e => e.candidate && a.addIceCandidate(e.candidate).catch(() => {});
        dest.stream.getTracks().forEach(t => a.addTrack(t, dest.stream));
        const got = new Promise(r => b.ontrack = e => r(e.streams[0]));
        const hi = sdp => sdp.replace(/a=fmtp:111 ([^\r\n]*)/, (m, p) => `a=fmtp:111 ${p};stereo=1;sprop-stereo=1;maxaveragebitrate=510000`);
        const off = await a.createOffer(); await a.setLocalDescription(off); await b.setRemoteDescription({ type: 'offer', sdp: hi(off.sdp) });
        const ans = await b.createAnswer(); await b.setLocalDescription(ans); await a.setRemoteDescription({ type: 'answer', sdp: hi(ans.sdp) });
        const out = $('#cineLoop'); out.srcObject = await got; out.muted = false; out.volume = 1; applySink(out);
        await out.play();
        if (!P.key) throw new Error('reset');
        this.active = true; video.muted = true; applyVol();
      } catch (e) { console.warn('cine loop', e); this.stop(); }
      this.trying = false;
    },
    setGain(v) { if (this.gain) this.gain.gain.setTargetAtTime(v, M.ctx.currentTime, 0.05); },
    stop() {
      this.pcs.forEach(p => { try { p.close(); } catch {} }); this.pcs = [];
      if (this.src) { try { this.src.disconnect(); } catch {} this.src = null; }
      if (this.gain) { try { this.gain.disconnect(); } catch {} this.gain = null; }
      if (this.cap) { this.cap.getTracks().forEach(t => { try { t.stop(); } catch {} }); this.cap = null; }
      const out = $('#cineLoop'); out.srcObject = null;
      this.active = false; if (video) video.muted = false;
    },
  };

  /* ---------- качество и озвучка (у каждого свои) ---------- */
  const qName = hh => hh ? (hh >= 2000 ? '4K' : hh >= 1400 ? '1440p' : hh + 'p') : '';
  function audioName(a, i) { const l = normLang(a.lang) || normLang(a.name); return l ? langName(l) : a.name || 'Дорожка ' + (i + 1); }
  function applyAudioPref() {
    const at = P.hls && P.hls.audioTracks; if (!at || at.length < 2) return;
    const pref = ls.get('cineAudio', null); if (!pref || typeof pref !== 'object') return;
    const i = at.findIndex(a => (normLang(a.lang) || normLang(a.name)) === pref.lang);
    if (i >= 0 && P.hls.audioTrack !== i) P.hls.audioTrack = i;
  }

  /* ---------- субтитры — у каждого свои ---------- */
  const Subs = {
    tracks: [], seq: 0, key: null, ptsSec: null, ptsWaiters: [], prep: Promise.resolve(), sig: '',
    size: ls.get('cineSubSize', 100), prefs: ls.get('subsLangs', null), touched: false, told: null,
    clear() { this.tracks = []; this.key = null; this.render(true); },
    reset(url, linkSubs, prep) {
      this.prep = prep || Promise.resolve(); this.ptsSec = null; this.ptsWaiters = [];
      if (this.key !== url) { this.tracks = []; this.key = url; this.touched = false; }
      else this.tracks = this.tracks.filter(t => t.from === 'own');
      for (const [url2, lang, label] of linkSubs) {
        if (this.tracks.some(t => t.url === url2)) continue;
        const l = normLang(lang) || langFromName(label || '') || langFromName(url2);
        this.add({ from: 'link', url: url2, lang: l, label: label && label !== 'Субтитры' ? String(label).slice(0, 40) : langName(l, 'Субтитры') });
      }
      this.auto(); this.ui();
    },
    add(t) { t.id = ++this.seq; t.cues = t.cues || null; t.state = t.cues ? 'ok' : 'idle'; t.on = false; t.delay = 0; this.tracks.push(t); return t; },
    fromHls() {
      const list = P.hls && P.hls.subtitleTracks || [];
      try { if (P.hls && P.hls.subtitleTrack !== -1) P.hls.subtitleTrack = -1; } catch {}
      for (const x of list) {
        if (!x.url || this.tracks.some(t => t.url === x.url)) continue;
        const l = normLang(x.lang) || normLang(x.name) || langFromName(x.name || '');
        this.add({ from: 'hls', url: x.url, lang: l, label: langName(l, String(x.name || 'Субтитры').slice(0, 40)) + (x.forced ? ' (надписи)' : '') });
      }
      this.auto(); this.ui();
    },
    setPTS(d) { if (this.ptsSec !== null || !d || (d.id && d.id !== 'main')) return; this.ptsSec = d.initPTS / (d.timescale || 90000); this.ptsWaiters.splice(0).forEach(f => f(this.ptsSec)); },
    pts() { return this.ptsSec !== null ? Promise.resolve(this.ptsSec) : new Promise(res => { this.ptsWaiters.push(res); setTimeout(() => res(null), 12000); }); },
    auto() {
      if (!this.tracks.length || this.touched) return;
      if (!Array.isArray(this.prefs)) {
        if (this.told !== this.key && this.tracks.some(t => t.from !== 'own')) { this.told = this.key; toast('Есть субтитры: ' + [...new Set(this.tracks.map(t => t.label))].slice(0, 4).join(', ') + ' — кнопка CC', { icon: 'film', ms: 5000 }); }
        return;
      }
      for (const lang of this.prefs) {
        if (this.tracks.some(t => t.on && (t.lang || t.label) === lang)) continue;
        const t = this.tracks.find(t => !t.on && (t.lang || t.label) === lang && t.from !== 'own'); if (t) this.toggle(t, true, true);
      }
    },
    savePrefs() { this.prefs = [...new Set(this.tracks.filter(t => t.on).map(t => t.lang || t.label))].slice(0, 6); ls.set('subsLangs', this.prefs); },
    toggle(t, on, auto) {
      t.on = on; if (!auto) { this.touched = true; this.savePrefs(); }
      if (on && !t.cues && t.state !== 'loading') this.load(t);
      this.ui(); this.render(true);
    },
    async fetchOk(url) {
      if (!/^https:\/\//i.test(url)) throw new Error('not https');
      const r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r;
    },
    async load(t) {
      t.state = 'loading'; t.err = ''; this.ui();
      const key = this.key;
      try {
        await this.prep;
        const buf = await (await this.fetchOk(t.url)).arrayBuffer();
        if (buf.byteLength > 8e6) throw new Error('слишком большой файл');
        const txt = decodeText(buf);
        const parsed = /^\s*#EXTM3U/.test(txt) ? await this.loadHls(txt, t.url, t) : parseSubs(txt);
        if (parsed.map) { const pts = await this.pts(); const off = parsed.map.mpegts / 90000 - parsed.map.local - (pts ?? parsed.map.mpegts / 90000); parsed.cues.forEach(c => { c.s += off; c.e += off; }); }
        if (!parsed.cues.length) throw new Error('нет реплик');
        if (this.key !== key) return;
        if (!t.lang) { t.lang = langFromText(parsed.cues.slice(0, 300).map(c => c.x).join('\n')); if (t.lang && /^Субтитры/.test(t.label)) t.label = langName(t.lang); }
        t.cues = parsed.cues.slice(0, 20000); t.state = 'ok';
      } catch (e) {
        t.state = 'err'; t.err = /нет реплик/.test(e.message) ? 'в файле нет реплик' : EXT.present ? 'сервер не отдал файл' : 'сервер не отдал файл — может помочь расширение «Сеанс»';
        console.warn('subs', e);
      }
      this.ui(); this.render(true);
    },
    // субтитры внутри HLS — плейлист из маленьких .vtt: сначала грузим те, что рядом с текущим моментом
    async loadHls(text, base, t) {
      if (/#EXT-X-STREAM-INF|TYPE=SUBTITLES/.test(text)) {
        const m = text.match(/#EXT-X-MEDIA:[^\n]*TYPE=SUBTITLES[^\n]*URI="([^"]+)"/); if (!m) throw new Error('нет субтитров');
        base = new URL(m[1], base).href; text = decodeText(await (await this.fetchOk(base)).arrayBuffer());
      }
      const segs = []; let at = 0, dur = 0;
      for (const l of text.split('\n').map(x => x.trim())) {
        if (l.startsWith('#EXTINF:')) dur = parseFloat(l.slice(8)) || 0;
        else if (l && !l.startsWith('#')) { segs.push({ url: new URL(l, base).href, at }); at += dur; }
      }
      if (!segs.length) throw new Error('пустой плейлист');
      const now = vtime(), key = this.key;
      const queue = segs.slice(0, 3000).sort((a, b) => (a.at + 15 < now) - (b.at + 15 < now) || Math.abs(a.at - now) - Math.abs(b.at - now));
      const seen = new Set(); let first = null, pts, asked = false, ok = 0, i = 0;
      const add = async txt => {
        const p = parseSubs(txt);
        if (p.map && !asked) { asked = true; pts = await this.pts(); }
        if (p.map && first === null) first = p.map.mpegts / 90000;
        const off = p.map ? p.map.mpegts / 90000 - p.map.local - (pts ?? first) : 0;
        const fresh = [];
        for (const c of p.cues) { const k = (c.s + off).toFixed(2) + '|' + c.x; if (seen.has(k)) continue; seen.add(k); fresh.push({ s: c.s + off, e: c.e + off, x: c.x }); }
        if (fresh.length) t.cues = (t.cues || []).concat(fresh).sort((a, b) => a.s - b.s);
        if (t.state === 'loading' && t.cues && t.cues.length) { t.state = 'ok'; this.ui(); }
      };
      await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
        while (i < queue.length && this.key === key) { const sg = queue[i++]; try { await add(decodeText(await (await this.fetchOk(sg.url)).arrayBuffer())); ok++; } catch {} }
      }));
      if (!ok) throw new Error('куски не загрузились');
      return { cues: t.cues || [], map: null };
    },
    async addFiles(files) {
      if (!hasFilm()) return toast('Сначала выберите фильм');
      for (const f of files) {
        if (f.size > 8e6) { toast(`«${f.name}» — слишком большой для субтитров`); continue; }
        const text = decodeText(await f.arrayBuffer()), p = parseSubs(text);
        if (!p.cues.length) { toast(`«${f.name}» — не похоже на субтитры (нужен .srt, .vtt или .ass)`); continue; }
        const l = langFromName(f.name) || langFromText(text);
        const t = this.add({ from: 'own', lang: l, label: langName(l, f.name.replace(/\.[^.]+$/, '').slice(0, 40)), cues: p.cues.slice(0, 20000) });
        this.toggle(t, true); toast('Субтитры: ' + t.label, { icon: 'check' });
      }
    },
    active(cues, t) {
      let lo = 0, hi = cues.length - 1, k = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (cues[m].s <= t) { k = m; lo = m + 1; } else hi = m - 1; }
      const out = [];
      for (let i = k; i >= 0 && i > k - 40; i--) if (cues[i].e > t) out.unshift(cues[i]);
      return out;
    },
    render(force) {
      if (!E.subs) return;
      const on = this.tracks.filter(t => t.on && t.cues);
      const now = vtime(), rows = [];
      if (hasFilm()) on.forEach((t, i) => { const lines = this.active(t.cues, now - t.delay); if (lines.length) rows.push({ c: SUB_COLORS[i % SUB_COLORS.length], lines }); });
      const sig = rows.map(r => r.c + r.lines.map(l => l.s + l.x).join('|')).join('#');
      if (!force && sig === this.sig) return;
      this.sig = sig;
      E.subs.style.setProperty('--sub-scale', this.size / 100);
      E.subs.replaceChildren(...rows.reverse().map(r => { const d = h('div', { class: 'sub-tr' }, r.lines.map(l => cueNodes(l.x))); d.style.color = r.c; return d; }));
    },
    quick() {
      const on = this.tracks.filter(t => t.on);
      if (on.length) { this.lastOn = on.map(t => t.id); on.forEach(t => this.toggle(t, false)); return toast('Субтитры выключены'); }
      let ids = (this.lastOn || []).filter(id => this.tracks.some(t => t.id === id));
      if (!ids.length && this.tracks[0]) ids = [this.tracks[0].id];
      if (!ids.length) return toast('Субтитров нет — добавьте файл в меню CC');
      ids.forEach(id => this.toggle(this.tracks.find(t => t.id === id), true));
    },
    ui() { if (!E.cc) return; const n = this.tracks.filter(t => t.on).length; E.cc.classList.toggle('on', n > 0); E.cc.classList.toggle('has', this.tracks.length > 0); if (popKind === 'cc') fillPop(); },
  };
  setInterval(() => Subs.render(), 120);

  /* ---------- всплывающие меню плеера ---------- */
  let popKind = null;
  function closePop() { if (E.pop) E.pop.classList.add('hidden'); popKind = null; }
  function popMenu(kind) { if (popKind === kind) return closePop(); popKind = kind; E.pop.classList.remove('hidden'); fillPop(); }
  function sec(text) { return h('div', { class: 'cp-sec', text }); }
  function item(label, small, on, fn) { return h('button', { class: 'cp-item' + (on ? ' on' : ''), type: 'button', onclick: fn }, h('i', { class: 'ck' }), h('span', {}, h('b', { text: label }), small ? h('small', { text: small }) : null)); }
  function fillPop() {
    if (!popKind) return;
    const box = E.pop, kids = [];
    if (popKind === 'cc') {
      kids.push(h('p', { class: 'cp-hint', text: 'Субтитры видите только вы. Можно включить несколько сразу.' }));
      if (!Subs.tracks.length) kids.push(h('p', { class: 'cp-hint', text: 'В этом видео субтитров не нашлось. Добавьте файл — или перетащите его на экран.' }));
      const from = { link: 'с сайта', hls: 'в потоке', own: 'ваши' };
      for (const t of Subs.tracks) {
        const info = t.state === 'loading' ? 'загружаются…' : t.state === 'err' ? t.err : (from[t.from] || '') + (t.cues ? ' · ' + t.cues.length + ' реплик' : '');
        const row = h('div', { class: 'cp-track' }, item(t.label, info, t.on, () => Subs.toggle(t, !t.on)));
        if (t.from === 'own') row.append(h('button', { class: 'cp-x', type: 'button', 'aria-label': 'Убрать', onclick: () => { Subs.tracks = Subs.tracks.filter(x => x !== t); Subs.ui(); Subs.render(true); } }, svgIcon('close')));
        kids.push(row);
        if (t.on) kids.push(h('div', { class: 'cp-delay' }, h('span', { text: 'Сдвиг' }),
          h('button', { class: 'cp-mini', type: 'button', text: '−', onclick: () => { t.delay = Math.round((t.delay - 0.5) * 10) / 10; fillPop(); Subs.render(true); } }),
          h('b', { class: 'tnum', text: (t.delay > 0 ? '+' : '') + t.delay.toFixed(1) + ' с' }),
          h('button', { class: 'cp-mini', type: 'button', text: '+', onclick: () => { t.delay = Math.round((t.delay + 0.5) * 10) / 10; fillPop(); Subs.render(true); } })));
      }
      kids.push(h('button', { class: 'cp-add', type: 'button', onclick: () => $('#cineSubIn').click() }, svgIcon('plus'), h('span', { text: 'Свой файл субтитров' })));
      const seg = h('div', { class: 'seg' }, [[80, 'Мелкие'], [100, 'Средние'], [130, 'Крупные']].map(([v, n]) => h('button', { class: 'seg-btn' + (Subs.size === v ? ' active' : ''), type: 'button', text: n, onclick: () => { Subs.size = v; ls.set('cineSubSize', v); fillPop(); Subs.render(true); } })));
      kids.push(sec('Размер'), seg);
    } else {
      const lv = P.hls && P.hls.levels || [];
      kids.push(sec('Качество — только у вас'));
      if (lv.length > 1) {
        const auto = P.hls.autoLevelEnabled;
        kids.push(item('Авто', 'по скорости интернета', auto, () => { P.hls.currentLevel = -1; fillPop(); }));
        lv.map((l, i) => ({ l, i })).sort((a, b) => b.l.height - a.l.height).forEach(({ l, i }) => kids.push(item(qName(l.height) || 'Вариант ' + (i + 1), (l.bitrate / 1e6).toFixed(1) + ' Мбит/с', !auto && P.hls.currentLevel === i, () => { P.hls.currentLevel = i; fillPop(); })));
      } else kids.push(h('p', { class: 'cp-hint', text: video && video.videoHeight ? `У этого видео одно качество: ${qName(video.videoHeight)}.` : 'У этого видео одно качество.' }));
      const at = P.hls && P.hls.audioTracks || [];
      if (at.length > 1) {
        kids.push(sec('Озвучка — только у вас'));
        at.forEach((a, i) => kids.push(item(audioName(a, i), a.name && audioName(a, i) !== a.name ? String(a.name).slice(0, 40) : '', P.hls.audioTrack === i, () => { P.hls.audioTrack = i; ls.set('cineAudio', { lang: normLang(a.lang) || normLang(a.name) }); fillPop(); })));
      }
      kids.push(sec('Звук'));
      kids.push(h('button', { class: 'cp-switch' + (P.duckOn ? ' on' : ''), type: 'button', onclick: () => { P.duckOn = !P.duckOn; ls.set('cineDuck', P.duckOn); fillPop(); } }, h('span', { text: 'Приглушать фильм, когда говорят' }), h('span', { class: 'switch', 'aria-hidden': 'true' })));
      kids.push(h('p', { class: 'cp-hint' + (Loop.active ? ' good' : ''), text: Loop.active ? 'Эхо фильма вычитается из микрофона.' : hasFilm() && P.ready ? 'Звук этого фильма браузер не может вычесть из микрофона — лучше наушники.' : 'Эхоподавление включится, когда фильм заиграет.' }));
    }
    const sc = box.scrollTop; box.replaceChildren(...kids); box.scrollTop = sc;
    box.style.maxHeight = Math.max(200, E.stage.clientHeight - 90) + 'px';
  }

  /* ---------- отрисовка плеера ---------- */
  function drawSeek(t) {
    const d = vdur(), p = d ? Math.max(0, Math.min(1, t / d)) * 100 : 0;
    E.fill.style.width = p + '%'; E.knob.style.left = p + '%';
  }
  function ui() {
    if (!built) return;
    const film = hasFilm();
    E.title.textContent = film ? (st.title || 'Без названия') : 'Кино вместе';
    E.change.querySelector('span').textContent = film ? 'Сменить' : 'Фильм';
    E.empty.classList.toggle('hidden', film);
    video.classList.toggle('hidden', !film);
    E.bar.classList.toggle('hidden', !film);
    E.stage.classList.toggle('playing', !!(film && st.playing));
    // сообщения поверх
    let msg = null;
    if (film && P.need) msg = { icon: 'file', title: 'Выберите такой же файл', text: `Включён файл «${P.need}». Выберите у себя этот же фильм — время у всех общее.`, btn: ['Выбрать файл', () => pickFile('need')] };
    else if (film && P.err) msg = { icon: 'film', title: 'Видео не загрузилось', text: P.err, btn: ['Повторить', () => { P.key = null; applyState(true); }], alt: ['Другая ссылка', () => openSrc()] };
    else if (film && P.blocked) msg = { icon: 'play', title: '', text: 'Браузер ждёт нажатия, чтобы включить фильм со звуком.', btn: ['Смотреть', () => { M.ctx && M.ctx.resume(); tryPlay(); }] };
    const sig = msg ? msg.title + msg.text : '';
    if (sig !== E.msgSig) {
      E.msgSig = sig;
      E.msg.classList.toggle('hidden', !msg);
      if (msg) E.msg.replaceChildren(svgIcon(msg.icon), msg.title ? h('b', { text: msg.title }) : null, h('p', { text: msg.text }),
        h('div', { class: 'row-gap' }, h('button', { class: 'btn btn-primary btn-sm', type: 'button', text: msg.btn[0], onclick: msg.btn[1] }), msg.alt ? h('button', { class: 'btn btn-glass btn-sm', type: 'button', text: msg.alt[0], onclick: msg.alt[1] }) : null));
    }
    E.spin.classList.toggle('hidden', !(film && !msg && (P.buffering || (!P.ready && !P.need))));
    setIcon(E.play, film && st.playing ? 'pause' : 'play'); E.play.setAttribute('aria-label', film && st.playing ? 'Пауза' : 'Смотреть');
    setIcon(E.mute, P.muted || P.vol === 0 ? 'mute' : 'volume');
    E.vol.value = P.muted ? 0 : P.vol;
    setIcon(E.fs, document.fullscreenElement ? 'shrink' : 'expand');
    E.opts.classList.toggle('hidden', !film);
    E.cc.classList.toggle('hidden', !film);
    if (!E.seekDrag()) drawSeek(film ? vtime() : 0);
    E.time.textContent = film ? fmt(vtime()) + (vdur() ? ' / ' + fmt(vdur()) : '') : '0:00';
    if (film && vdur() && video.buffered && video.buffered.length) {
      let end = 0; for (let i = 0; i < video.buffered.length; i++) if (video.buffered.start(i) <= vtime() + 1) end = Math.max(end, video.buffered.end(i));
      E.buf.style.width = Math.min(100, end / vdur() * 100) + '%';
    } else E.buf.style.width = '0';
  }
  function setIcon(btn, name) { if (btn._ic === name) return; btn._ic = name; btn.replaceChildren(svgIcon(name)); }
  setInterval(() => { if (built && visible && isOn()) ui(); }, 250);

  /* ---------- кто на какой секунде ---------- */
  function myStatus() {
    if (!hasFilm()) return null;
    if (P.err) return 'err'; if (P.need) return 'nofile'; if (P.blocked) return 'blocked';
    if (!P.ready || P.buffering) return 'buf';
    return video.paused ? 'pause' : 'play';
  }
  setInterval(() => { const s = myStatus(); if (s && S.inCall) send({ t: 'cpos', p: P.ready ? vtime() : null, s }); }, 1500);
  setInterval(() => {
    if (!built || !hasFilm()) { if (E.sync) E.sync.classList.add('hidden'); return; }
    const exp = expectedPos(st), bad = [];
    for (const m of S.members) {
      if (m.id === me.id) continue;
      const x = peers[m.id]; if (!x || Date.now() - x.got > 6000) continue;
      const map = { err: ['bad', 'видео не загрузилось'], nofile: ['warn', 'выбирает файл'], blocked: ['warn', 'ждёт нажатия'], buf: ['warn', 'загружается'] };
      if (map[x.s]) { bad.push({ n: m.name, c: map[x.s][0], t: map[x.s][1] }); continue; }
      if (x.s === 'pause' && st.playing) { bad.push({ n: m.name, c: 'warn', t: 'на паузе' }); continue; }
      let t = x.p; if (t == null) continue; if (x.s === 'play') t += Math.max(0, hubNow() - x.at) / 1000;
      const d = t - exp; if (Math.abs(d) < 1.5) continue;
      bad.push({ n: m.name, c: Math.abs(d) > 4 ? 'bad' : 'warn', t: (d < 0 ? 'отстаёт на ' : 'впереди на ') + Math.round(Math.abs(d)) + ' с' });
    }
    const others = S.members.length > 1;
    E.sync.classList.toggle('hidden', !others);
    if (!others) return;
    if (!bad.length) { E.syncDot.className = 'dot ok'; E.syncTxt.textContent = st.playing ? 'Все смотрят вместе' : 'Все на паузе вместе'; }
    else { const w = bad.find(b => b.c === 'bad') || bad[0]; E.syncDot.className = 'dot ' + w.c; E.syncTxt.textContent = `${w.n}: ${w.t}` + (bad.length > 1 ? ` (+${bad.length - 1})` : ''); }
  }, 600);

  /* ---------- выбор фильма ---------- */
  let fileMode = 'room';
  function openSrc(url, title) {
    if (!isOn()) return;
    $('#cineUrl').value = url || ''; $('#cineName').value = title || '';
    $('#cineSrcErr').classList.add('hidden'); extUi();
    $('#cineSrc').classList.remove('hidden');
    setTimeout(() => $(url ? '#cineName' : '#cineUrl').focus(), 60);
  }
  function srcErr(t) { const e = $('#cineSrcErr'); e.textContent = t; e.classList.remove('hidden'); }
  function guessTitle(url) {
    try { const u = new URL(splitRef(url).clean); const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname); return last.replace(/\.(mp4|m3u8|webm|mkv|mov|m4v)$/i, '').replace(/[_.-]+/g, ' ').trim().slice(0, 60) || u.hostname; }
    catch { return 'Фильм'; }
  }
  function submitSrc(e) {
    e.preventDefault();
    let url = $('#cineUrl').value.trim();
    if (!url) return srcErr('Вставьте ссылку на видео');
    url = url.replace(/^[\s\S]*?(https?:\/\/)/i, '$1').split(/\s/)[0];
    if (/^http:\/\//i.test(url)) url = 'https://' + url.slice(7);
    if (!/^https:\/\//i.test(url)) return srcErr('Нужна ссылка, начинающаяся с https://');
    const clean = splitRef(url).clean;
    if (/(youtube\.com|youtu\.be|vk\.com|vk\.ru|vkvideo\.ru|rutube\.ru)/i.test(clean)) return srcErr('YouTube, VK и Rutube здесь не открываются — нужна прямая ссылка на видеофайл или поток.');
    if (/(rezka|hdrezka|kinopoisk|lordfilm|kinogo|baskino|ivi\.ru|okko|kion|start\.ru|wink\.ru|filmix)/i.test(clean) && !/\.(mp4|m3u8|webm)/i.test(clean)) return srcErr('Это ссылка на страницу сайта. Нужна прямая ссылка на видео — её достаёт расширение «Сеанс».');
    if (!Cine.urlOk(url, 'video')) return srcErr('Ссылка не подходит');
    const kind = /\.m3u8(\?|#|$)|\/manifest|\bhls\b|:hls:/i.test(clean) ? 'hls' : 'video';
    act('load', { url, kind, title: $('#cineName').value.trim().slice(0, 80) || guessTitle(url) });
    $('#cineSrc').classList.add('hidden');
  }
  function pickFile(mode) { fileMode = mode; $('#cineFileIn').click(); }
  function onFile(f) {
    if (!f) return;
    if (P.file) URL.revokeObjectURL(P.file.url);
    if (fileMode === 'room') {
      const key = 'file:' + f.name.replace(/[\n\r]/g, ' ').slice(0, 200) + ':' + f.size;
      P.file = { key, url: URL.createObjectURL(f) };
      act('load', { url: key, kind: 'file', title: f.name.replace(/\.[^.]+$/, '').slice(0, 80) });
      $('#cineSrc').classList.add('hidden');
    } else if (hasFilm()) {
      const size = +(st.url.match(/:(\d+)$/) || [])[1];
      if (size && size !== f.size) toast('Размер файла отличается — проверьте, тот ли это фильм', { icon: 'file', ms: 4500 });
      P.file = { key: st.url, url: URL.createObjectURL(f) }; P.key = null; applyState(true);
    }
  }

  /* ---------- весь экран ---------- */
  function toggleFs() {
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    const root = $('#call');
    if (root.requestFullscreen && document.fullscreenEnabled) root.requestFullscreen().catch(() => {});
    else if (video && video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  }
  document.addEventListener('fullscreenchange', () => { layout(); ui(); });

  function closeLocal() {
    resetPlayer(); P.key = null; P.kind = null; Subs.clear();
    visible = false; closePop();
    $('#cineSrc').classList.add('hidden');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    for (const k of Object.keys(peers)) delete peers[k];
    render();
  }
  function reset() {
    st = null; closeLocal();
    if (P.file) { URL.revokeObjectURL(P.file.url); P.file = null; }
  }

  /* ---------- клавиши, когда кинозал на экране ---------- */
  addEventListener('keydown', e => {
    if (!S.inCall || !visible || !hasFilm() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('.modal:not(.hidden)')) return;
    if (e.code === 'Space' || e.code === 'KeyK') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); act('seek', { pos: vtime() - 10 }); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); act('seek', { pos: vtime() + 10 }); }
    else if (e.code === 'KeyF') toggleFs();
    else if (e.code === 'KeyC') Subs.quick();
  });

  window.addEventListener('DOMContentLoaded', () => {
    $('#cinePill').onclick = () => show();
    $('#cineSrcForm').addEventListener('submit', submitSrc);
    $('#cineFileBtn').onclick = () => pickFile('room');
    $('#cineFileIn').onchange = e => { onFile(e.target.files[0]); e.target.value = ''; };
    $('#cineSubIn').onchange = e => { Subs.addFiles([...e.target.files]); e.target.value = ''; };
    window.postMessage({ source: 'seans-page', type: 'ping' }, location.origin);
    extUi();
  });

  return { onState, onPos, toggle, show, hide, reset, get open() { return isOn(); } };
})();
