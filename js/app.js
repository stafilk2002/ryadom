'use strict';
/* =====================================================================
   РЯДОМ — видеозвонки без сервера.
   Связь: PeerJS (только сигналинг) + WebRTC напрямую «каждый с каждым».
   Комнату «ведёт» браузер одного из участников (hub). Если он уходит,
   его место занимает следующий, а звонки между остальными не рвутся —
   они идут напрямую и от hub не зависят.
   ===================================================================== */
const CFG = window.CONFIG;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ls = {
  get(k, d) { try { const v = localStorage.getItem('ryadom.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ryadom.' + k, JSON.stringify(v)); } catch {} },
};
const IS_TOUCH = matchMedia('(pointer: coarse)').matches;
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🎉', '🔥', '👎'];

/* ---------- случайность и коды ---------- */
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // без O/0, I/1/L
function randStr(n, abc) {
  const out = []; const lim = 256 - (256 % abc.length);
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) { if (b < lim && out.length < n) out.push(abc[b % abc.length]); }
  }
  return out.join('');
}
const genCode = () => randStr(8, CODE_ABC);
const fmtCode = c => c ? c.slice(0, 4) + '-' + c.slice(4) : '';
const normCode = s => [...String(s || '').toUpperCase()].filter(ch => CODE_ABC.includes(ch)).join('');
const isCode = c => typeof c === 'string' && c.length === 8 && [...c].every(ch => CODE_ABC.includes(ch));
const enc = s => new TextEncoder().encode(s);
const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function sha256hex(s) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc(s)))].map(b => b.toString(16).padStart(2, '0')).join(''); }
const cleanName = s => String(s || '').replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, '').trim().slice(0, 24) || 'Гость';

const Crypt = {
  async deriveKey(password, saltB64) {
    const base = await crypto.subtle.importKey('raw', enc(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: fromB64(saltB64), iterations: CFG.pbkdf2Iterations, hash: 'SHA-256' },
      base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']);
  },
  async sign(key, msg) { return toB64(await crypto.subtle.sign('HMAC', key, enc(msg))); },
  async verify(key, msg, mac) { try { return await crypto.subtle.verify('HMAC', key, fromB64(String(mac)), enc(msg)); } catch { return false; } },
  nonce() { return toB64(crypto.getRandomValues(new Uint8Array(24))); },
};

/* ---------- мелочи интерфейса ---------- */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}
function hue(s) { let x = 7; for (const c of String(s)) x = (x * 31 + c.codePointAt(0)) >>> 0; return x % 360; }
const colorFor = () => '#8a8e97'; // нейтральные аватары, как в «Контактах»
const initial = s => ([...String(s || '?').trim()][0] || '?').toUpperCase();
function avatar(name, cls = 'person-ava') { return h('span', { class: cls, text: initial(name) }); }
function setIcon(container, name) { const el = container.matches('[data-icon]') ? container : container.querySelector('[data-icon]'); if (el && el.dataset.icon !== name) { el.dataset.icon = name; paintIcons(container.parentNode || container); } }

function toast(text, opt = {}) {
  const box = $('#toasts');
  const t = h('div', { class: 'toast glass-strong' });
  if (opt.ava) t.append(avatar(opt.ava, 'toast-ava'));
  else if (opt.icon) t.append(svgIcon(opt.icon));
  t.append(h('span', { text }));
  box.append(t);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, opt.ms || 2800);
}
async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg, { icon: 'check' }); }
  catch {
    const i = h('textarea'); i.value = text; document.body.append(i); i.select();
    try { document.execCommand('copy'); toast(okMsg, { icon: 'check' }); } catch { toast(text, { ms: 7000 }); }
    i.remove();
  }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function stamp() { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`; }
function fmtTime(sec) { sec = Math.max(0, Math.floor(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
function show(id) { $$('.screen').forEach(s => s.classList.toggle('hidden', s.id !== id)); }
function chime(up = true) {
  if (!M.ctx || M.ctx.state !== 'running') return;
  try {
    const t = M.ctx.currentTime, o = M.ctx.createOscillator(), g = M.ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(up ? 660 : 880, t); o.frequency.exponentialRampToValueAtTime(up ? 990 : 520, t + .18);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.06, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .35);
    o.connect(g).connect(M.ctx.destination); o.start(t); o.stop(t + .4);
  } catch {}
}

/* =====================================================================
   СОСТОЯНИЕ
   ===================================================================== */
const me = { id: null, name: ls.get('name', ''), joined: 0 };
const S = {
  mode: 'create', code: null, roomId: null, peer: null, conn: null, hub: null,
  offset: 0, bestRtt: Infinity, members: [], room: null, key: null, salt: null, createPass: '', meta: {},
  connected: false, leaving: false, reconnecting: false, pingTimer: null, lastPong: 0, inCall: false,
};
const hubNow = () => Date.now() + S.offset;
const amOwner = () => !!(S.room && S.room.owner === me.id);
const memberOf = id => S.members.find(m => m.id === id);
const nameOf = id => id === me.id ? me.name : (memberOf(id) || {}).name || 'Участник';

/* =====================================================================
   HUB — «сердце» комнаты в браузере одного из участников.
   Хранит только список участников и флаги комнаты, в памяти.
   ===================================================================== */
class Hub {
  constructor(roomId, room, key) {
    this.roomId = roomId; this.key = key || null;
    this.members = new Map(); this.pending = new Map(); this.recent = new Map();
    this.room = {
      hasPass: !!room.hasPass, salt: room.salt || null, locked: !!room.locked, owner: room.owner || null,
      banned: new Set(room.banned || []), known: new Set(room.known || []), rec: {}, ended: false,
      sched: room.sched || null,
    };
    this.cine = Cine.hubInit(room.cine);
    this.armEnd();
  }
  start() {
    return new Promise((res, rej) => {
      this.peer = new Peer(this.roomId, peerOpts());
      let opened = false;
      this.peer.on('open', () => { opened = true; res(this); });
      this.peer.on('error', e => { if (!opened) { rej(e); try { this.peer.destroy(); } catch {} } else console.warn('hub', e.type); });
      this.peer.on('disconnected', () => { if (!this.dead) setTimeout(() => { try { !this.dead && this.peer.reconnect(); } catch {} }, 1000); });
      this.peer.on('connection', c => this.onConn(c));
      this.peer.on('call', c => { try { c.close(); } catch {} });
    });
  }
  destroy() { this.dead = true; clearTimeout(this.endT); try { this.peer.destroy(); } catch {} }
  // встреча по расписанию: в назначенное время конец звонка для всех
  armEnd() {
    clearTimeout(this.endT);
    const sc = this.room.sched; if (!sc || !sc.e) return;
    const ms = sc.e * 1000 - Date.now();
    if (ms > 2147000000) return;
    this.endT = setTimeout(() => { if (this.dead) return; this.room.ended = true; this.broadcast({ t: 'ended', reason: 'time' }); setTimeout(() => this.destroy(), 1500); }, Math.max(0, ms));
  }
  onConn(c) {
    c.on('data', m => { this.onData(c, m).catch(e => console.error(e)); });
    const drop = () => this.drop(c);
    c.on('close', drop); c.on('error', drop);
    c.on('iceStateChanged', s => { if (s === 'failed' || s === 'closed') drop(); });
  }
  list() { return [...this.members.values()].map(({ conn, ...m }) => m).sort((a, b) => a.joined - b.joined); }
  pub() {
    const r = this.room;
    return { cine: this.cine, sched: r.sched, hasPass: r.hasPass, salt: r.salt, locked: r.locked, owner: r.owner, banned: [...r.banned].slice(-64), known: [...r.known].slice(-64), rec: Object.keys(r.rec).filter(id => this.members.has(id)) };
  }
  broadcast(m) { for (const x of this.members.values()) { try { x.conn.open && x.conn.send(m); } catch {} } }
  sendMembers() { this.broadcast({ t: 'members', list: this.list() }); }
  sendRoom() { this.broadcast({ t: 'room', room: this.pub() }); }
  deny(c, reason) { try { c.send({ t: 'denied', reason }); } catch {} setTimeout(() => { try { c.close(); } catch {} }, 400); }
  checkOwner() {
    if (this.dead) return;
    if (!this.room.owner || !this.members.has(this.room.owner)) {
      const first = this.list()[0];
      if (first) { this.room.owner = first.id; this.sendRoom(); }
    }
  }
  drop(c) {
    const p = this.pending.get(c.peer); if (p && p.conn === c) this.pending.delete(c.peer);
    const m = this.members.get(c.peer);
    if (!m || m.conn !== c) return;
    this.members.delete(c.peer); delete this.room.rec[c.peer];
    this.sendMembers(); this.sendRoom();
    setTimeout(() => { if (!this.dead && !this.members.has(m.id)) this.broadcast({ t: 'sys', k: 'leave', id: m.id, name: m.name }); }, 4000);
    if (m.id === this.room.owner) setTimeout(() => this.checkOwner(), 6000);
  }
  admit(id, p) {
    const old = this.members.get(id); if (old && old.conn !== p.conn) { try { old.conn.close(); } catch {} }
    this.members.set(id, { id, name: p.name, mic: p.mic, cam: p.cam, screen: false, joined: p.joined, conn: p.conn });
    this.room.known.add(id);
    if (!this.room.owner) this.room.owner = id;
    p.conn.send({ t: 'welcome', now: Date.now(), room: this.pub(), members: this.list() });
    this.sendMembers(); this.sendRoom();
    if (!p.rejoin) this.broadcast({ t: 'sys', k: 'join', id, name: p.name });
  }
  async onData(c, m) {
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    const id = c.peer, r = this.room, mem = this.members.get(id);
    if (m.t === 'hello') {
      if (mem && mem.conn === c) return;
      if (r.sched && r.sched.e && Date.now() > r.sched.e * 1000) return this.deny(c, 'expired');
      if (r.ended) return this.deny(c, 'ended');
      if (r.banned.has(id)) return this.deny(c, 'kicked');
      const known = r.known.has(id);
      if (r.locked && !known) return this.deny(c, 'locked');
      if (!known && this.members.size >= CFG.maxPeople) return this.deny(c, 'full');
      const p = { conn: c, name: cleanName(m.name), mic: !!m.mic, cam: !!m.cam, joined: Number(m.joined) || Date.now(), rejoin: !!m.rejoin && known };
      if (!r.hasPass) return this.admit(id, p);
      if (!this.key) return this.deny(c, 'error');
      p.hn = Crypt.nonce(); this.pending.set(id, p);
      // комната доказывает новичку, что знает пароль; новичок — комнате
      const hp = await Crypt.sign(this.key, `hub|${this.roomId}|${String(m.cn || '').slice(0, 64)}|${id}`);
      try { c.send({ t: 'challenge', needPass: true, salt: r.salt, hn: p.hn, hp }); } catch {}
      setTimeout(() => { if (this.pending.get(id) === p) { this.pending.delete(id); this.deny(c, 'timeout'); } }, 180000);
      return;
    }
    if (m.t === 'auth') {
      const p = this.pending.get(id); if (!p || p.conn !== c) return;
      this.pending.delete(id);
      const ok = await Crypt.verify(this.key, `join|${this.roomId}|${p.hn}|${id}`, m.mac);
      if (!ok) return this.deny(c, 'pass');
      if (r.banned.has(id)) return this.deny(c, 'kicked');
      if (r.locked && !r.known.has(id)) return this.deny(c, 'locked');
      return this.admit(id, p);
    }
    if (!mem || mem.conn !== c) return; // всё остальное — только от участников
    switch (m.t) {
      case 'ping': c.send({ t: 'pong', c: m.c, h: Date.now() }); break;
      case 'status': mem.mic = !!m.mic; mem.cam = !!m.cam; mem.screen = !!m.screen; this.sendMembers(); break;
      case 'chat': { const text = String(m.text || '').slice(0, 500).trim(); if (text) this.broadcast({ t: 'chat', from: id, name: mem.name, text, ts: Date.now() }); break; }
      case 'react': if (REACTIONS.includes(m.e)) this.broadcast({ t: 'react', from: id, name: mem.name, e: m.e }); break;
      case 'rec': if (m.on) r.rec[id] = true; else delete r.rec[id]; this.sendRoom(); this.broadcast({ t: 'sys', k: m.on ? 'rec' : 'recoff', id, name: mem.name }); break;
      case 'shot': this.broadcast({ t: 'sys', k: 'shot', id, name: mem.name }); break;
      case 'g': {
        let size = 0; try { size = JSON.stringify(m.d).length; } catch { return; }
        if (size > 6000) return;
        const out = { t: 'g', from: id, d: m.d };
        if (m.to) { const t = this.members.get(m.to); if (t) { try { t.conn.send(out); } catch {} } } else this.broadcast(out);
        break;
      }
      case 'cine': if (Cine.hubAct(this.cine, m.a, id)) this.broadcast({ t: 'cine', s: this.cine, a: String(m.a.type), from: id, name: mem.name }); break;
      case 'cpos': if (this.cine.open) this.broadcast({ t: 'cpos', id, p: Number.isFinite(+m.p) ? +m.p : null, s: String(m.s || '').slice(0, 8), at: Date.now() }); break;
      case 'kick': {
        if (id !== r.owner || m.id === id) return;
        const t = this.members.get(m.id);
        r.banned.add(m.id); r.known.delete(m.id);
        this.broadcast({ t: 'kicked', id: m.id, name: t ? t.name : '' });
        if (t) { this.members.delete(m.id); setTimeout(() => { try { t.conn.close(); } catch {} }, 300); }
        this.sendMembers(); this.sendRoom();
        break;
      }
      case 'lock': if (id !== r.owner) return; r.locked = !!m.on; this.sendRoom(); this.broadcast({ t: 'sys', k: r.locked ? 'lock' : 'unlock', id, name: mem.name }); break;
      case 'end': if (id !== r.owner) return; r.ended = true; this.broadcast({ t: 'ended', name: mem.name }); setTimeout(() => this.destroy(), 1500); break;
    }
  }
}

/* =====================================================================
   ПОДКЛЮЧЕНИЕ
   ===================================================================== */
function peerOpts() { return { ...CFG.peer, debug: 1, config: { iceServers: CFG.iceServers } }; }
const newPeerId = () => CFG.appPrefix + 'u' + randStr(22, 'abcdefghijklmnopqrstuvwxyz0123456789');
async function hubIdFor(code) { return CFG.appPrefix + 'r' + (await sha256hex('ryadom-room|' + code)).slice(0, 32); }

function createPeer() {
  return new Promise((res, rej) => {
    const p = new Peer(newPeerId(), peerOpts());
    const t = setTimeout(() => rej(new Error('signal-timeout')), 15000);
    p.on('open', () => { clearTimeout(t); res(p); });
    p.on('error', e => { if (!p.open) { clearTimeout(t); rej(e); } else if (e.type !== 'peer-unavailable') console.warn('peer', e.type, e.message); });
    p.on('disconnected', () => { if (!S.leaving) setTimeout(() => { try { !p.destroyed && p.reconnect(); } catch {} }, 1000); });
    p.on('call', onIncomingCall);
    p.on('connection', c => { try { c.close(); } catch {} }); // участники не принимают прямых data-соединений
  });
}
const errOf = (msg, extra) => Object.assign(new Error(msg), extra);

function tryConnect(timeout, rejoin) {
  return new Promise((res, rej) => {
    const conn = S.peer.connect(S.roomId, { reliable: true });
    let done = false, timer = 0, challenged = false;
    const finish = (err, val) => {
      if (done) return; done = true; clearTimeout(timer); S.peer.off('error', onErr);
      if (err) { try { conn.close(); } catch {} rej(err); } else res(val);
    };
    const onErr = e => { if (e.type === 'peer-unavailable' && String(e.message).includes(S.roomId)) finish(errOf('unavailable', { retry: true })); };
    const arm = ms => { clearTimeout(timer); timer = setTimeout(() => finish(errOf('timeout', { retry: true })), ms); };
    arm(timeout);
    S.peer.on('error', onErr);
    const cn = Crypt.nonce();
    conn.on('open', () => conn.send({ t: 'hello', name: me.name, mic: micLive(), cam: M.camOn, joined: me.joined, rejoin, cn }));
    conn.on('data', async m => {
      if (!m || typeof m !== 'object') return;
      if (!done) {
        if (m.t === 'challenge') {
          clearTimeout(timer); challenged = true;
          try {
            const mac = await answerChallenge(m, cn);
            if (done) return;
            if (!mac) return finish(errOf('cancel', { reason: 'cancel' }));
            conn.send({ t: 'auth', mac }); arm(15000);
          } catch (e) { finish(e); }
        } else if (m.t === 'denied') finish(errOf('denied', { reason: String(m.reason) }));
        else if (m.t === 'welcome') {
          if (S.key && !challenged) return finish(errOf('badhub', { reason: 'badhub' })); // «комната» без пароля, хотя он был — подмена
          finish(null, conn); onMessage(m, conn);
        }
        return;
      }
      if (S.conn === conn) onMessage(m, conn);
    });
    conn.on('close', () => { if (!done) finish(errOf('closed', { retry: true })); else if (S.conn === conn) onHubLost(); });
    conn.on('error', () => { if (!done) finish(errOf('conn-error', { retry: true })); });
  });
}

async function answerChallenge(m, cn) {
  if (!m.salt || !m.hp || !m.hn) throw errOf('bad', { reason: 'error' });
  const hubMsg = `hub|${S.roomId}|${cn}|${me.id}`;
  let key = S.key && S.salt === m.salt ? S.key : null;
  if (key) { if (!(await Crypt.verify(key, hubMsg, m.hp))) throw errOf('badhub', { reason: 'badhub' }); }
  else {
    let wrong = false;
    for (;;) {
      const pw = await askPassword(wrong);
      if (pw == null) return null;
      const k = await Crypt.deriveKey(pw, m.salt);
      if (await Crypt.verify(k, hubMsg, m.hp)) { key = k; S.key = k; S.salt = m.salt; closePassword(); break; }
      wrong = true;
    }
  }
  return Crypt.sign(key, `join|${S.roomId}|${m.hn}|${me.id}`);
}

let pwResolve = null;
function askPassword(wrong) {
  return new Promise(res => {
    pwResolve = res;
    $('#pwModal').classList.remove('hidden');
    $('#pwErr').classList.toggle('hidden', !wrong);
    const i = $('#pwInput'); i.disabled = false; i.value = ''; setTimeout(() => i.focus(), 60);
    $('#pwForm button[type=submit]').disabled = false;
  });
}
function closePassword() { $('#pwModal').classList.add('hidden'); pwResolve = null; }

async function becomeHub() {
  const r = S.room || { hasPass: !!S.key, salt: S.salt, owner: me.id, known: [me.id], banned: [], locked: false, sched: Sched.fromMeta(S.meta) };
  const h = new Hub(S.roomId, r, S.key);
  await h.start();
  S.hub = h;
  setTimeout(() => h.checkOwner(), 9000);
  return h;
}

async function ensureConnected(rejoin) {
  for (let attempt = 0; attempt < 14 && !S.leaving; attempt++) {
    try {
      S.conn = await tryConnect(attempt === 0 ? 5000 : 7000, rejoin || (attempt > 0 && S.inCall));
      S.connected = true; setConn(true); return true;
    } catch (e) {
      if (e.reason) { onDenied(e.reason); return false; }
      console.log('connect failed:', e.message);
    }
    if (S.leaving) return false;
    if (!S.hub) {
      try {
        await becomeHub();
        if (!S.inCall && S.mode === 'join') setTimeout(() => toast('Комната была пустой — вы открыли её заново', { icon: 'info', ms: 4200 }), 900);
        continue;
      } catch (e) { await sleep(e && e.type === 'unavailable-id' ? 400 : 1200 + Math.random() * 800); }
    } else await sleep(800);
  }
  if (!S.leaving) { toast('Не удалось подключиться. Проверьте интернет и попробуйте снова.', { ms: 6000 }); if (!S.inCall) leave('neterr'); }
  return false;
}

async function onHubLost() {
  if (S.leaving || S.reconnecting) return;
  S.reconnecting = true; S.connected = false; S.conn = null; setConn(false);
  // очередь: участник, зашедший раньше всех, поднимает комнату первым
  const rank = Math.max(0, S.members.findIndex(m => m.id === me.id));
  await sleep(rank <= 1 ? 300 + rank * 600 : Math.min(rank, 7) * 1300);
  if (S.hub && S.hub.dead) S.hub = null;
  await ensureConnected(true);
  S.reconnecting = false;
}

function setConn(ok) { $('#connDot').classList.toggle('bad', !ok); $('#reconnect').classList.toggle('hidden', ok || !S.inCall); }
function send(m) { if (S.conn && S.conn.open) { try { S.conn.send(m); return true; } catch {} } return false; }

function startPings() {
  clearInterval(S.pingTimer); S.bestRtt = Infinity; S.lastPong = Date.now();
  const ping = () => send({ t: 'ping', c: performance.now() });
  ping(); setTimeout(ping, 400); setTimeout(ping, 900);
  S.pingTimer = setInterval(() => {
    if (S.connected && Date.now() - S.lastPong > 8000) { const c = S.conn; S.conn = null; try { c && c.close(); } catch {} onHubLost(); return; }
    ping();
  }, 2000);
}

const DENY_TEXT = {
  pass: ['Неверный пароль', 'Комната не пустила: пароль не подошёл.'],
  locked: ['Вход закрыт', 'Организатор закрыл вход в эту комнату.'],
  kicked: ['Вас удалили из звонка', 'Организатор удалил вас из этой комнаты.'],
  full: ['Комната заполнена', `В звонке уже ${CFG.maxPeople} человек — это максимум.`],
  ended: ['Звонок завершён', 'Организатор завершил звонок для всех.'],
  badhub: ['Не удалось проверить комнату', 'Пароль комнаты не совпал. Возможно, её пересоздали — попросите новую ссылку.'],
  timeout: ['Время вышло', 'Комната не дождалась ответа.'],
  error: ['Ошибка комнаты', 'Попробуйте зайти ещё раз.'],
  expired: ['Встреча завершилась', 'Время этой встречи уже прошло. Попросите новую ссылку.'],
  time: ['Время встречи вышло', 'Звонок завершился по расписанию.'],
};
function onDenied(reason) {
  closePassword();
  if (reason === 'cancel') { leave('cancel'); return; }
  leave(reason);
}

/* ---------- сообщения от hub ---------- */
function onMessage(m, conn) {
  switch (m.t) {
    case 'welcome':
      S.conn = conn; S.offset = m.now - Date.now(); S.bestRtt = Infinity;
      S.room = sanitizeRoom(m.room); if (S.room.salt) S.salt = S.room.salt;
      setMembers(m.members); onRoom(); startPings();
      if (!S.inCall) enterCall();
      Cinema.onState(S.room.cine, { welcome: true });
      break;
    case 'pong': {
      const rtt = performance.now() - m.c; S.lastPong = Date.now();
      if (rtt <= S.bestRtt * 1.3 || rtt < 60) { S.bestRtt = Math.min(S.bestRtt, rtt); S.offset = m.h + rtt / 2 - Date.now(); }
      break;
    }
    case 'members': setMembers(m.list); break;
    case 'room': S.room = sanitizeRoom(m.room); onRoom(); Cinema.onState(S.room.cine, { room: true }); break;
    case 'sys': onSys(m); break;
    case 'chat': addChat(m); break;
    case 'react': if (m.from !== me.id && REACTIONS.includes(m.e)) FX.emoji(m.e, cleanName(m.name)); break;
    case 'g': Games.onMsg(String(m.from), m.d); break;
    case 'cine': Cinema.onState(Cine.clean(m.s), m); break;
    case 'cpos': Cinema.onPos(m); break;
    case 'kicked':
      if (m.id === me.id) { leave('kicked'); return; }
      closeCallWith(m.id); toast(`${cleanName(m.name)} удалён(а) из звонка`, { icon: 'userX' });
      break;
    case 'ended': leave(m.reason === 'time' ? 'time' : 'ended', cleanName(m.name)); break;
  }
}
function sanitizeRoom(r) {
  r = r && typeof r === 'object' ? r : {};
  const arr = a => Array.isArray(a) ? a.filter(x => typeof x === 'string').slice(0, 64) : [];
  return { cine: Cine.clean(r.cine), sched: Sched.clean(r.sched), hasPass: !!r.hasPass, salt: typeof r.salt === 'string' ? r.salt : null, locked: !!r.locked, owner: typeof r.owner === 'string' ? r.owner : null, banned: arr(r.banned), known: arr(r.known), rec: arr(r.rec) };
}
function setMembers(list) {
  if (!Array.isArray(list)) return;
  const before = new Set(S.members.map(m => m.id));
  S.members = list.filter(m => m && typeof m.id === 'string').slice(0, 16).map(m => ({ id: m.id, name: cleanName(m.name), mic: !!m.mic, cam: !!m.cam, screen: !!m.screen, joined: +m.joined || 0 }));
  // автозакрепление демонстрации экрана
  for (const m of S.members) {
    if (m.id === me.id) continue;
    const prev = (Tiles.screenSeen[m.id] || false);
    if (m.screen && !prev && !L.pinned) { L.pinned = m.id; L.autoPin = true; }
    if (!m.screen && prev && L.pinned === m.id && L.autoPin) { L.pinned = null; L.autoPin = false; }
    Tiles.screenSeen[m.id] = m.screen;
  }
  if (L.pinned && L.pinned !== me.id && !S.members.some(m => m.id === L.pinned)) L.pinned = null;
  renderPeople(); syncMesh(); Tiles.sync(); layout(); updateTopbar();
  Games.onMembers(before);
}
function onRoom() {
  const r = S.room || {};
  Sched.callTick();
  $('#lockPill').classList.toggle('hidden', !r.locked);
  $('#ownerTools').classList.toggle('hidden', !amOwner());
  $('[data-act=endall]').classList.toggle('hidden', !amOwner());
  $('#lockBtn').classList.toggle('on', !!r.locked);
  setIcon($('#lockBtn'), r.locked ? 'unlock' : 'lock');
  $('#lockBtnText').textContent = r.locked ? 'Открыть вход в комнату' : 'Закрыть вход в комнату';
  const recs = (r.rec || []).filter(id => id === me.id || memberOf(id));
  $('#recPill').classList.toggle('hidden', !recs.length);
  if (recs.length && !Rec.active) $('#recText').textContent = 'Запись · ' + recs.map(nameOf).join(', ');
  renderPeople();
}
function onSys(m) {
  const name = cleanName(m.name);
  const self = m.id === me.id;
  const lines = {
    join: [`${name} — в звонке`, `${name} присоединяется к звонку`],
    leave: [`${name} покидает звонок`, `${name} покидает звонок`],
    rec: [`${name} начинает запись звонка`, `${name} начинает запись`],
    recoff: [`${name} останавливает запись`, `Запись остановлена · ${name}`],
    shot: [`${name} делает снимок звонка`, `Снимок звонка · ${name}`],
    lock: ['Вход в комнату закрыт', `${name} закрывает вход в комнату`],
    unlock: ['Вход в комнату открыт', `${name} открывает вход в комнату`],
  }[m.k];
  if (!lines) return;
  addChat({ t: 'sys', text: lines[0] });
  if (self && m.k !== 'lock' && m.k !== 'unlock') return;
  if (m.k === 'join') chime(true); else if (m.k === 'leave') chime(false);
  const icon = { rec: 'record', recoff: 'stop', shot: 'shot', lock: 'lock', unlock: 'unlock' }[m.k];
  toast(lines[1], icon ? { icon } : { ava: name });
}

/* =====================================================================
   МЕДИА: микрофон через «шумовые ворота», камера, экран
   ===================================================================== */
const M = {
  ctx: null, raw: null, srcNode: null, analyser: null, gate: null, dest: null, outTrack: null, blankTrack: null,
  camTrack: null, screenTrack: null, stream: null, calls: new Map(), remotes: new Map(), missing: {},
  micOn: true, camOn: false, asked: false, denied: false, facing: 'user',
  gateDb: ls.get('gateDb', -55), ptt: ls.get('ptt', false), pttDown: false,
  voiceVol: ls.get('voiceVol', 1), vols: {}, level: -100, open: false, lastLoud: 0,
  mirror: ls.get('mirror', false),
};
const micLive = () => !!(M.raw && M.micOn);
function audioConstraints(id) { return { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, ...(id ? { deviceId: { exact: id } } : {}) }; }
function videoConstraints(noId) {
  const id = noId ? '' : ls.get('camId', '');
  return { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 }, ...(id ? { deviceId: { exact: id } } : { facingMode: M.facing }) };
}
async function ensureAudioGraph() {
  if (M.ctx) { try { await M.ctx.resume(); } catch {} return; }
  M.ctx = new (window.AudioContext || window.webkitAudioContext)();
  try { await M.ctx.resume(); } catch {}
  M.dest = M.ctx.createMediaStreamDestination();
  M.gate = M.ctx.createGain(); M.gate.gain.value = 0; M.gate.connect(M.dest);
  M.outTrack = M.dest.stream.getAudioTracks()[0];
  // пустое видео, пока камера выключена — камера потом включается заменой дорожки
  const cv = h('canvas'); cv.width = 160; cv.height = 90; const g = cv.getContext('2d');
  const paint = () => { g.fillStyle = '#000'; g.fillRect(0, 0, 160, 90); }; paint(); setInterval(paint, 1000);
  M.blankTrack = cv.captureStream(2).getVideoTracks()[0];
  M.stream = new MediaStream([M.outTrack, M.blankTrack]);
  gateLoop();
}
function setMicStream(s) {
  if (M.raw && M.raw !== s) M.raw.getTracks().forEach(t => t.stop());
  if (M.srcNode) { try { M.srcNode.disconnect(); } catch {} }
  M.raw = s; M.srcNode = M.ctx.createMediaStreamSource(s);
  M.analyser = M.ctx.createAnalyser(); M.analyser.fftSize = 1024;
  M.srcNode.connect(M.analyser); M.srcNode.connect(M.gate);
  const tr = s.getAudioTracks()[0];
  const st = tr && tr.getSettings ? tr.getSettings() : {};
  $('#aecInfo').textContent = st.echoCancellation === false ? 'Внимание: эхоподавление в этом браузере выключено — лучше пользоваться наушниками.' : 'Эхоподавление, шумоподавление и автоусиление включены.';
  tr && (tr.onended = () => { if (M.raw === s) { M.raw = null; updateControls(); sendStatus(); } });
}
async function requestDevices(wantCam) {
  await ensureAudioGraph();
  M.asked = true;
  const gum = c => navigator.mediaDevices.getUserMedia(c);
  let s = null;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { M.denied = true; return false; }
  try { s = await gum({ audio: audioConstraints(ls.get('micId', '')), video: wantCam ? videoConstraints() : false }); }
  catch (e) {
    if (e && e.name === 'NotAllowedError') { M.denied = true; }
    else {
      try { s = await gum({ audio: audioConstraints(), video: wantCam ? videoConstraints(true) : false }); }
      catch { try { s = await gum({ audio: audioConstraints() }); } catch {} }
    }
  }
  if (!s) { M.denied = true; await fillDevices(); return false; }
  M.denied = false;
  const a = s.getAudioTracks()[0], v = s.getVideoTracks()[0];
  if (a) setMicStream(new MediaStream([a]));
  if (v) { if (M.camTrack && M.camTrack !== v) M.camTrack.stop(); M.camTrack = v; M.camOn = true; v.onended = () => { if (M.camTrack === v) setCam(false); }; }
  await fillDevices();
  return true;
}
async function openMic(id) {
  await ensureAudioGraph();
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(id) }); setMicStream(s); M.micOn = true; M.asked = true; await fillDevices(); return true; }
  catch (e) { console.warn('mic', e); toast('Микрофон недоступен — вы в режиме «только слушать»', { icon: 'micOff' }); return false; }
  finally { updateControls(); sendStatus(); }
}
function rms(an, buf) { an.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return 20 * Math.log10(Math.sqrt(s / buf.length) + 1e-9); }
function gateLoop() {
  const buf = new Float32Array(1024);
  const pct = db => Math.max(0, Math.min(100, (db + 80) / 60 * 100));
  setInterval(() => {
    const now = performance.now();
    let want = false;
    if (M.raw && M.analyser) {
      M.level = rms(M.analyser, buf);
      if (M.ptt) want = M.pttDown;
      else if (M.level > M.gateDb) { M.lastLoud = now; want = true; }
      else want = now - M.lastLoud < 380; // «хвост», чтобы не обрезать окончания слов
      if (!M.micOn) want = false;
      if (document.hidden && M.micOn && !M.ptt) want = true; // в фоне таймеры замедлены — держим ворота открытыми
    } else M.level = -100;
    if (want !== M.open) { M.open = want; M.gate.gain.setTargetAtTime(want ? 1 : 0, M.ctx.currentTime, want ? 0.008 : 0.06); }
    const lv = M.micOn ? pct(M.level) : 0;
    const pv = $('#pvMeter'); if (pv && !$('#preview').classList.contains('hidden')) pv.style.width = lv + '%';
    if (!$('#settings').classList.contains('hidden')) { const gm = $('#gateMeter'); gm.style.width = pct(M.level) + '%'; gm.classList.toggle('open', M.open); }
    const meSpeaking = M.open && M.level > M.gateDb - 3;
    const st = Tiles.get(me.id); if (st) st.el.classList.toggle('speaking', meSpeaking);
    $('#micBtn').classList.toggle('talking', M.ptt && M.pttDown && micLive());
    markSpeaking(me.id, meSpeaking);
    let talking = false;
    for (const [id, r] of M.remotes) {
      if (!r.an) continue;
      const on = rms(r.an, buf) > -52; if (on) r.last = now;
      const sp = now - (r.last || 0) < 400; if (sp) talking = true;
      const t = Tiles.get(id); if (t) t.el.classList.toggle('speaking', sp);
      markSpeaking(id, sp);
    }
    M.talking = talking;
  }, 50);
}
function markSpeaking(id, on) { const li = $(`#peopleList [data-id="${CSS.escape(id)}"]`); if (li) li.classList.toggle('speaking', on); }
function sendStatus() { send({ t: 'status', mic: micLive(), cam: M.camOn, screen: !!M.screenTrack }); }

function currentVideoTrack() { return M.screenTrack || (M.camOn && M.camTrack) || M.blankTrack; }
function replaceVideo(track) {
  if (!track || !M.stream) return;
  M.stream.getVideoTracks().forEach(t => M.stream.removeTrack(t)); M.stream.addTrack(track);
  for (const call of M.calls.values()) {
    const pc = call.peerConnection; if (!pc) continue;
    pc.getTransceivers().forEach(tr => {
      const kind = (tr.sender.track && tr.sender.track.kind) || (tr.receiver && tr.receiver.track && tr.receiver.track.kind);
      if (kind === 'video') tr.sender.replaceTrack(track).catch(() => {});
    });
  }
  tuneSenders();
}
function tuneSenders() {
  const n = Math.max(1, M.calls.size);
  const br = M.screenTrack ? 2500000 : n <= 1 ? 1800000 : n <= 3 ? 900000 : 500000;
  for (const call of M.calls.values()) {
    const pc = call.peerConnection; if (!pc) continue;
    for (const s of pc.getSenders()) {
      if (!s.track || s.track.kind !== 'video') continue;
      try { const p = s.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}]; p.encodings[0].maxBitrate = br; s.setParameters(p).catch(() => {}); } catch {}
    }
  }
}
async function setCam(on) {
  if (on) {
    if (!M.camTrack || M.camTrack.readyState === 'ended') {
      try {
        await ensureAudioGraph();
        const s = await navigator.mediaDevices.getUserMedia({ video: videoConstraints() }).catch(() => navigator.mediaDevices.getUserMedia({ video: videoConstraints(true) }));
        M.camTrack = s.getVideoTracks()[0]; M.asked = true;
        const tr = M.camTrack; tr.onended = () => { if (M.camTrack === tr) setCam(false); };
        fillDevices();
      } catch { toast('Камера недоступна', { icon: 'camOff' }); return; }
    }
    M.camOn = true;
  } else {
    M.camOn = false;
    if (M.camTrack) M.camTrack.stop(); M.camTrack = null;
  }
  if (!M.screenTrack) replaceVideo(currentVideoTrack());
  updateControls(); renderPreview(); Tiles.refreshSelf(); sendStatus();
}
async function switchCamera(deviceId, facing) {
  if (deviceId !== undefined) ls.set('camId', deviceId);
  if (facing) { M.facing = facing; ls.set('camId', ''); }
  if (!M.camOn) return;
  if (M.camTrack) M.camTrack.stop(); M.camTrack = null; // iOS не отдаёт вторую камеру, пока открыта первая
  await setCam(true);
}
async function toggleScreen() {
  if (M.screenTrack) return stopScreen();
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 }, width: { max: 1920 }, height: { max: 1080 } }, audio: false });
    const tr = s.getVideoTracks()[0]; if (!tr) return;
    try { tr.contentHint = 'detail'; } catch {}
    M.screenTrack = tr; tr.onended = () => { if (M.screenTrack === tr) stopScreen(); };
    replaceVideo(tr); updateControls(); Tiles.refreshSelf(); sendStatus();
    toast('Вы показываете экран', { icon: 'screen' });
  } catch (e) { if (e && e.name !== 'NotAllowedError') toast('Не удалось начать демонстрацию', { icon: 'screenOff' }); }
}
function stopScreen() {
  const tr = M.screenTrack; if (!tr) return;
  M.screenTrack = null; try { tr.stop(); } catch {}
  replaceVideo(currentVideoTrack()); updateControls(); Tiles.refreshSelf(); sendStatus();
}

/* ---------- устройства ---------- */
const SINK_OK = 'setSinkId' in HTMLMediaElement.prototype;
async function fillDevices() {
  let list = [];
  try { list = await navigator.mediaDevices.enumerateDevices(); } catch {}
  const fill = (sel, kind, key, fallback) => {
    const cur = sel.value || ls.get(key, '');
    sel.replaceChildren();
    const items = list.filter(d => d.kind === kind);
    if (!items.length) sel.append(h('option', { value: '', text: fallback }));
    items.forEach((d, i) => sel.append(h('option', { value: d.deviceId, text: d.label || `${fallback} ${i + 1}` })));
    const active = kind === 'audioinput' && M.raw ? (M.raw.getAudioTracks()[0]?.getSettings?.().deviceId) : kind === 'videoinput' && M.camTrack ? M.camTrack.getSettings?.().deviceId : null;
    sel.value = [active, cur].find(v => v && items.some(d => d.deviceId === v)) || (items[0] ? items[0].deviceId : '');
  };
  for (const [mic, cam, spk] of [['#pvMicSel', '#pvCamSel', '#pvSpkSel'], ['#setMic', '#setCam', '#setSpk']]) {
    fill($(mic), 'audioinput', 'micId', 'Микрофон');
    fill($(cam), 'videoinput', 'camId', 'Камера');
    fill($(spk), 'audiooutput', 'spkId', 'Динамики');
  }
  const hasSpk = SINK_OK && list.some(d => d.kind === 'audiooutput');
  $('#pvSpkWrap').classList.toggle('hidden', !hasSpk); $('#setSpkWrap').classList.toggle('hidden', !hasSpk);
  const cams = list.filter(d => d.kind === 'videoinput').length;
  document.body.classList.toggle('can-flip', IS_TOUCH && cams > 1);
}
function applySink(el) { const id = ls.get('spkId', ''); if (SINK_OK && id && el.setSinkId) el.setSinkId(id).catch(() => {}); }

/* =====================================================================
   ЗВОНКИ «каждый с каждым»
   ===================================================================== */
function syncMesh() {
  if (!S.peer || S.leaving) return;
  const ids = new Set(S.members.map(m => m.id));
  if (!ids.has(me.id)) return;
  for (const m of S.members) {
    if (m.id === me.id) continue;
    if (!M.calls.has(m.id) && me.id < m.id) callPeer(m.id); // звонит тот, у кого id «меньше» — без двойных соединений
  }
  // звонок закрываем, только если человека нет дольше 15 с (при смене хозяина список на миг пустеет)
  const now = Date.now();
  for (const [id, call] of M.calls) {
    if (ids.has(id)) { delete M.missing[id]; continue; }
    if (S.reconnecting) continue;
    if (!M.missing[id]) { M.missing[id] = now; setTimeout(syncMesh, 15500); continue; }
    if (now - M.missing[id] > 15000) { delete M.missing[id]; closeCallWith(id); }
  }
}
function callPeer(id) {
  const call = S.peer.call(id, M.stream);
  if (call) setupCall(call);
}
async function onIncomingCall(call) {
  // принимаем звонки только от участников комнаты; незнакомцев сбрасываем
  const known = () => S.members.some(m => m.id === call.peer) && S.members.some(m => m.id === me.id);
  for (let i = 0; i < 12 && !known() && !S.leaving; i++) await sleep(250); // список мог ещё не дойти
  if (!known() || S.leaving) { try { call.close(); } catch {} return; }
  const old = M.calls.get(call.peer); if (old && old !== call) { try { old.close(); } catch {} }
  call.answer(M.stream); setupCall(call);
}
function setupCall(call) {
  M.calls.set(call.peer, call);
  call.on('stream', s => { if (M.calls.get(call.peer) === call) { attachRemote(call.peer, s); setTimeout(() => replaceVideo(currentVideoTrack()), 300); } });
  const gone = () => { if (M.calls.get(call.peer) === call) { M.calls.delete(call.peer); dropRemote(call.peer); setTimeout(syncMesh, 1500 + Math.random() * 1500); } };
  call.on('close', gone); call.on('error', gone);
  const watch = () => {
    const pc = call.peerConnection; if (!pc) return setTimeout(watch, 200);
    pc.addEventListener('iceconnectionstatechange', () => { if (pc.iceConnectionState === 'failed') { try { call.close(); } catch {} gone(); } });
  };
  watch();
}
function closeCallWith(id) { const c = M.calls.get(id); M.calls.delete(id); if (c) { try { c.close(); } catch {} } dropRemote(id); }
function attachRemote(id, stream) {
  const t = Tiles.ensure(id);
  let r = M.remotes.get(id);
  if (!r) { r = { id, last: 0 }; M.remotes.set(id, r); }
  const fresh = r.stream !== stream;
  r.stream = stream;
  if (t.video.srcObject !== stream) t.video.srcObject = stream;
  t.video.muted = false;
  applySink(t.video); applyVol(id);
  t.video.play().catch(() => { $('#tapAudio').classList.remove('hidden'); });
  t.video.onresize = () => layout();
  if (fresh) {
    try { r.src && r.src.disconnect(); } catch {}
    try { const src = M.ctx.createMediaStreamSource(stream); r.an = M.ctx.createAnalyser(); r.an.fftSize = 1024; src.connect(r.an); r.src = src; } catch {}
  }
  Rec.addStream(id, stream);
  Tiles.sync(); layout();
}
function dropRemote(id) {
  const r = M.remotes.get(id);
  if (r) { try { r.src && r.src.disconnect(); } catch {} M.remotes.delete(id); Rec.removeStream(id); }
  const t = Tiles.get(id); if (t) { t.video.srcObject = null; }
  Tiles.sync(); layout();
}
function applyVol(id) {
  const t = Tiles.get(id); if (!t || id === me.id) return;
  const v = Math.max(0, Math.min(1, (M.vols[id] ?? 1) * M.voiceVol));
  try { t.video.volume = v; } catch {}
}

/* =====================================================================
   ПЛИТКИ И РАСКЛАДКА
   ===================================================================== */
const L = {
  mode: ls.get('layout', 'pip'), pinned: null, autoPin: false, swap: false,
  corner: ls.get('pipCorner', 'br'), pipW: ls.get('pipW', IS_TOUCH ? 112 : 260), game: false, cine: false,
};
const Tiles = {
  map: new Map(), screenSeen: {},
  get(id) { return this.map.get(id); },
  ensure(id) {
    let t = this.map.get(id); if (t) { if (t.dying) { clearTimeout(t.dying); t.dying = 0; t.el.classList.remove('gone'); } return t; }
    const self = id === me.id;
    const el = h('div', { class: 'tile' + (self ? ' self' : ''), 'data-id': id });
    const video = h('video', { autoplay: true, playsinline: true }); video.autoplay = true; video.playsInline = true;
    if (self) video.muted = true;
    const ava = h('div', { class: 'tile-ava' }, h('span'));
    const badge = h('div', { class: 'tile-badge hidden' }, svgIcon('screen'), h('span', { text: 'Экран' }));
    const label = h('div', { class: 'tile-label' });
    const menuBtn = h('button', { class: 'tile-menu-btn', type: 'button', 'aria-label': 'Действия' }, svgIcon('dots'));
    el.append(video, ava, badge, label, menuBtn);
    let grip = null;
    if (self) {
      grip = h('div', { class: 'resize-grip', 'data-c': 'tl', 'aria-hidden': 'true' }); el.append(grip);
      const flip = h('button', { class: 'tile-flip', type: 'button', 'aria-label': 'Сменить камеру' }, svgIcon('flip'));
      flip.addEventListener('pointerdown', e => e.stopPropagation());
      flip.addEventListener('click', e => { e.stopPropagation(); switchCamera(undefined, M.facing === 'user' ? 'environment' : 'user'); });
      el.append(flip);
    }
    t = { id, el, video, ava, badge, label, menuBtn, grip, self };
    this.map.set(id, t);
    $('#stage').append(el);
    menuBtn.addEventListener('click', e => { e.stopPropagation(); tileMenu(t); });
    el.addEventListener('dblclick', () => { if (!el.classList.contains('float')) togglePin(id); });
    if (self) initFloatDrag(t);
    else el.addEventListener('click', () => { if (el.classList.contains('float')) { L.swap = !L.swap; layout(); } });
    this.update(t);
    return t;
  },
  remove(id) {
    const t = this.map.get(id); if (!t || t.dying) return;
    t.el.classList.add('gone');
    t.dying = setTimeout(() => { t.el.remove(); this.map.delete(id); }, 300);
  },
  sync() {
    if (!S.inCall) return;
    this.ensure(me.id);
    const keep = new Set([me.id, ...S.members.map(m => m.id), ...M.calls.keys()]);
    for (const m of S.members) if (m.id !== me.id) this.ensure(m.id);
    if (!S.reconnecting) for (const id of [...this.map.keys()]) if (!keep.has(id)) this.remove(id);
    for (const t of this.map.values()) this.update(t);
  },
  update(t) {
    const m = t.self ? { name: me.name, mic: micLive(), cam: M.camOn, screen: !!M.screenTrack } : (memberOf(t.id) || { name: '…', mic: true, cam: false, screen: false });
    const hasVideo = t.self ? !!(M.screenTrack || (M.camOn && M.camTrack)) : !!(m.cam || m.screen) && !!t.video.srcObject;
    const span = t.ava.firstChild; span.textContent = initial(m.name);
    t.ava.classList.toggle('hidden', hasVideo);
    t.el.classList.toggle('screen', !!m.screen);
    t.badge.classList.toggle('hidden', !m.screen);
    t.video.classList.toggle('mirrored', t.self && M.mirror && !m.screen);
    const lab = [];
    if (!m.mic) lab.push(svgIcon('micOff'));
    lab.push(h('span', { text: t.self ? 'Вы' : m.name }));
    t.label.replaceChildren(...lab);
  },
  refreshSelf() {
    const t = this.get(me.id); if (!t) return;
    const want = M.screenTrack || (M.camOn ? M.camTrack : null);
    if ((t.video._t || null) !== want) { t.video._t = want; t.video.srcObject = want ? new MediaStream([want]) : null; if (want) t.video.play().catch(() => {}); }
    this.update(t); layout();
  },
  ordered() {
    const out = [];
    const st = this.get(me.id); if (st) out.push(st);
    for (const m of S.members) { if (m.id === me.id) continue; const t = this.get(m.id); if (t && !t.dying) out.push(t); }
    for (const t of this.map.values()) if (!out.includes(t) && !t.dying) out.push(t);
    return out;
  },
};

function togglePin(id) { L.pinned = L.pinned === id ? null : id; L.autoPin = false; layout(); }

function gridRects(n, x0, y0, W, H, gap, aspect) {
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (W - gap * (cols - 1)) / cols, ch = (H - gap * (rows - 1)) / rows;
    if (cw <= 0 || ch <= 0) continue;
    const eff = Math.min(cw, ch * aspect);
    const score = eff * eff / aspect;
    if (!best || score > best.score * 1.02) best = { cols, rows, cw, ch, score };
  }
  if (!best) return [];
  const { cols, rows } = best;
  const tw = Math.min(best.cw, best.ch * aspect * 1.6), th = Math.min(best.ch, best.cw / aspect * 1.6);
  const totalH = rows * th + (rows - 1) * gap, yStart = y0 + (H - totalH) / 2;
  const rects = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols), inRow = row === rows - 1 ? n - cols * (rows - 1) : cols, col = i - row * cols;
    const rowW = inRow * tw + (inRow - 1) * gap, xStart = x0 + (W - rowW) / 2;
    rects.push({ x: xStart + col * (tw + gap), y: yStart + row * (th + gap), w: tw, h: th });
  }
  return rects;
}
function stripRects(n, x0, y, W, hgt, gap) {
  let w = hgt * 16 / 9; const total = n * w + (n - 1) * gap;
  if (total > W) w = (W - (n - 1) * gap) / n;
  const hh = Math.min(hgt, w * 9 / 16 * 1.25);
  const start = x0 + (W - (n * w + (n - 1) * gap)) / 2;
  return Array.from({ length: n }, (_, i) => ({ x: start + i * (w + gap), y, w, h: hh }));
}
function safe() {
  const cs = getComputedStyle(document.documentElement);
  const v = n => parseFloat(cs.getPropertyValue(n)) || 0;
  return { t: v('--safe-t'), b: v('--safe-b'), l: v('--safe-l'), r: v('--safe-r') };
}
function floatSize(t, W, H) {
  const v = t.video; let a = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : (W < H ? 3 / 4 : 16 / 9);
  a = Math.max(.56, Math.min(1.78, a));
  const maxW = Math.min(W * (W < H ? .45 : .4), 560);
  const w = Math.max(96, Math.min(L.pipW, maxW));
  return { w, h: w / a };
}
function floatPos(corner, w, hgt, W, H, sf) {
  const m = 14;
  const top = 64 + sf.t, bottom = (IS_TOUCH ? 96 : 104) + sf.b;
  return { x: corner[1] === 'l' ? m + sf.l : W - w - m - sf.r, y: corner[0] === 't' ? top : H - hgt - bottom };
}
function place(t, r, cls) {
  const s = t.el.style;
  s.left = r.x + 'px'; s.top = r.y + 'px'; s.width = r.w + 'px'; s.height = r.h + 'px';
  s.borderRadius = cls === 'bleed' ? '0px' : Math.round(Math.max(10, Math.min(30, Math.min(r.w, r.h) * .085))) + 'px';
  t.el.classList.toggle('bleed', cls === 'bleed');
  t.el.classList.toggle('float', cls === 'float');
  t.el.classList.toggle('small', r.w < 220 && cls !== 'float' ? true : cls === 'float' && r.w < 150);
}
function layout() {
  if (!S.inCall) return;
  const stage = $('#stage'), W = stage.clientWidth, H = stage.clientHeight;
  if (!W || !H) return;
  const sf = safe();
  const tiles = Tiles.ordered(), n = tiles.length;
  const top = 60 + sf.t, bottom = (IS_TOUCH ? 92 : 100) + sf.b, side = 12;
  const gap = n > 4 ? 8 : 10;
  const area = { x: side + sf.l, y: top, w: W - 2 * side - sf.l - sf.r, h: H - top - bottom };
  $('#alone').classList.toggle('hidden', n > 1 || L.game || L.cine || S.aloneClosed);
  // layout-кнопка в меню
  const lb = $('[data-act=layout]');
  if (lb) { setIcon(lb, L.mode === 'pip' ? 'side' : 'pip'); lb.querySelector('.mi-text').textContent = L.mode === 'pip' ? 'Окна рядом, одного размера' : 'Собеседник крупно, я в углу'; lb.classList.toggle('hidden', n !== 2); }
  if (L.game || L.cine) {
    const hs = L.cine ? Math.max(56, Math.min(H * .12, 96)) : Math.max(64, Math.min(H * .14, 112));
    const rs = stripRects(n, area.x, top, area.w, hs, 8);
    tiles.forEach((t, i) => place(t, rs[i], 'strip'));
    const sh = Math.max(...rs.map(r => r.y + r.h), top + hs) - sf.t + 10;
    $('#gameLayer').style.setProperty('--strip-h', sh + 'px');
    $('#cineLayer').style.setProperty('--strip-h', sh + 'px');
    document.documentElement.style.setProperty('--strip-h', sh + 'px');
    return;
  }
  if (n === 1) { place(tiles[0], { x: 0, y: 0, w: W, h: H }, 'bleed'); return; }
  const pinned = L.pinned && tiles.find(t => t.id === L.pinned);
  if (n === 2 && L.mode === 'pip' && !pinned) {
    const selfT = tiles.find(t => t.self) || tiles[0], other = tiles.find(t => t !== selfT);
    const big = L.swap ? selfT : other, small = L.swap ? other : selfT;
    place(big, { x: 0, y: 0, w: W, h: H }, 'bleed');
    if (!small.el.classList.contains('dragging') && !small.el.classList.contains('resizing')) {
      const fs = floatSize(small, W, H), p = floatPos(L.corner, fs.w, fs.h, W, H, sf);
      place(small, { x: p.x, y: p.y, ...fs }, 'float');
      if (small.grip) small.grip.dataset.c = (L.corner[0] === 't' ? 'b' : 't') + (L.corner[1] === 'l' ? 'r' : 'l');
    }
    small.el.style.zIndex = 3; big.el.style.zIndex = 1;
    return;
  }
  tiles.forEach(t => t.el.style.zIndex = '');
  if (pinned) {
    const sh = Math.max(64, Math.min(area.h * .2, 120));
    const others = tiles.filter(t => t !== pinned);
    place(pinned, { x: area.x, y: area.y, w: area.w, h: area.h - sh - gap }, 'main');
    const rs = stripRects(others.length, area.x, area.y + area.h - sh, area.w, sh, 8);
    others.forEach((t, i) => place(t, rs[i], 'strip'));
    return;
  }
  const rects = gridRects(n, area.x, area.y, area.w, area.h, gap, W < H ? 3 / 4 : 16 / 9);
  tiles.forEach((t, i) => place(t, rects[i], 'grid'));
}
addEventListener('resize', () => layout());

function initFloatDrag(t) {
  const el = t.el;
  let st = null;
  el.addEventListener('pointerdown', e => {
    if (!el.classList.contains('float') || e.button > 0) return;
    if (e.target.closest('.tile-menu-btn')) return;
    const resize = e.target === t.grip;
    st = { x: e.clientX, y: e.clientY, l: el.offsetLeft, t: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, resize, moved: false };
    el.setPointerCapture(e.pointerId);
    el.classList.add(resize ? 'resizing' : 'dragging');
    e.preventDefault();
  });
  el.addEventListener('pointermove', e => {
    if (!st) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) st.moved = true;
    const W = $('#stage').clientWidth, H = $('#stage').clientHeight;
    if (st.resize) {
      const right = L.corner[1] === 'r', bottom = L.corner[0] === 'b', a = st.w / st.h;
      const dw = Math.max(right ? -dx : dx, (bottom ? -dy : dy) * a);
      const w = Math.max(96, Math.min(st.w + dw, Math.min(W * .6, 640))), hh = w / a;
      el.style.width = w + 'px'; el.style.height = hh + 'px';
      el.style.borderRadius = Math.round(Math.max(10, Math.min(30, Math.min(w, hh) * .085))) + 'px';
      el.style.left = (right ? st.l + st.w - w : st.l) + 'px';
      el.style.top = (bottom ? st.t + st.h - hh : st.t) + 'px';
    } else {
      el.style.left = Math.max(-st.w * .3, Math.min(W - st.w * .7, st.l + dx)) + 'px';
      el.style.top = Math.max(0, Math.min(H - st.h * .5, st.t + dy)) + 'px';
    }
  });
  const end = () => {
    if (!st) return;
    const s = st; st = null;
    el.classList.remove('dragging', 'resizing');
    if (s.resize) { L.pipW = el.offsetWidth; ls.set('pipW', L.pipW); }
    else if (s.moved) {
      const W = $('#stage').clientWidth, H = $('#stage').clientHeight;
      const cx = el.offsetLeft + el.offsetWidth / 2, cy = el.offsetTop + el.offsetHeight / 2;
      L.corner = (cy < H / 2 ? 't' : 'b') + (cx < W / 2 ? 'l' : 'r'); ls.set('pipCorner', L.corner);
    } else { L.swap = !L.swap; }
    layout();
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}

function closeMenus(except) {
  ['#moreMenu', '#endMenu', '#funMenu', '#reactBar'].forEach(s => { if (s !== except) $(s).classList.add('hidden'); });
  $$('.tile-pop').forEach(p => p.remove());
  if (except !== '#reactBar') $('#reactBtn').classList.remove('active');
}
function tileMenu(t) {
  const had = t.el.querySelector('.tile-pop');
  closeMenus();
  if (had) return;
  const pop = h('div', { class: 'tile-pop glass-strong' });
  pop.addEventListener('pointerdown', e => e.stopPropagation());
  pop.addEventListener('click', e => e.stopPropagation());
  if (!t.self) {
    const r = h('input', { type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': 'Громкость участника' });
    r.value = M.vols[t.id] ?? 1;
    r.oninput = () => { M.vols[t.id] = +r.value; applyVol(t.id); renderPeople(); };
    pop.append(h('div', { class: 'vol-row' }, svgIcon('volume'), r));
  }
  const item = (icon, text, fn, cls) => h('button', { class: 'menu-item' + (cls ? ' ' + cls : ''), type: 'button', onclick: () => { closeMenus(); fn(); } }, svgIcon(icon), h('span', { class: 'mi-text', text }));
  pop.append(item('pin', L.pinned === t.id ? 'Открепить' : 'Закрепить крупно', () => togglePin(t.id)));
  if (t.self) pop.append(item('mirror', M.mirror ? 'Не зеркалить' : 'Зеркалить себя', () => setMirror(!M.mirror)));
  if (!t.self && amOwner()) pop.append(item('userX', 'Удалить из звонка', () => kick(t.id), 'danger'));
  $('#call').append(pop);
  const r = t.menuBtn.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + 'px';
  pop.style.top = Math.min(innerHeight - pop.offsetHeight - 8, r.bottom + 6) + 'px';
  pop.style.right = 'auto';
}
function kick(id) {
  if (!amOwner()) return;
  if (!confirm(`Удалить «${nameOf(id)}» из звонка? Вернуться по этой же ссылке он(а) не сможет.`)) return;
  send({ t: 'kick', id });
}
function setMirror(v) {
  M.mirror = v; ls.set('mirror', v);
  $('[data-act=mirror]').classList.toggle('on', v);
  $('#mirrorSwitch').setAttribute('aria-checked', String(v));
  renderPreview(); Tiles.refreshSelf();
}

/* =====================================================================
   ИНТЕРФЕЙС ЗВОНКА
   ===================================================================== */
function updateControls() {
  const mic = $('#micBtn'), cam = $('#camBtn');
  const micOk = !!M.raw;
  setIcon(mic, micLive() ? 'mic' : 'micOff');
  mic.classList.toggle('off', !micLive());
  mic.setAttribute('aria-label', !micOk ? 'Микрофон недоступен' : micLive() ? 'Выключить микрофон' : 'Включить микрофон');
  mic.title = !micOk ? 'Нет доступа к микрофону — вы только слушаете' : M.ptt ? 'Режим рации: зажмите, чтобы говорить' : '';
  setIcon(cam, M.camOn ? 'cam' : 'camOff');
  cam.classList.toggle('off', !M.camOn);
  const sc = $('#screenBtn'); sc.classList.toggle('active', !!M.screenTrack); setIcon(sc, M.screenTrack ? 'screenOff' : 'screen');
  $('#pttPill').classList.toggle('hidden', !M.ptt || !S.inCall || IS_TOUCH);
  Tiles.refreshSelf();
}
function updateTopbar() {
  $('#peopleCount').textContent = String(S.members.length || 1);
}
function renderPeople() {
  const ul = $('#peopleList'); if (!ul) return;
  ul.replaceChildren();
  const owner = S.room && S.room.owner;
  for (const m of S.members) {
    const self = m.id === me.id;
    const li = h('li', { class: 'person', 'data-id': m.id });
    const row = h('div', { class: 'person-row' },
      avatar(m.name),
      h('span', { class: 'person-name' }, m.name, self ? h('small', { text: 'вы' }) : null, m.id === owner ? h('small', { text: '· организатор' }) : null),
      m.screen ? svgIcon('screen', 'on') : null,
      svgIcon(m.mic ? 'mic' : 'micOff', m.mic ? 'on' : ''),
      svgIcon(m.cam ? 'cam' : 'camOff', m.cam ? 'on' : ''));
    li.append(row);
    if (!self) {
      const r = h('input', { type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': 'Громкость: ' + m.name });
      r.value = M.vols[m.id] ?? 1;
      r.oninput = () => { M.vols[m.id] = +r.value; applyVol(m.id); };
      const vol = h('div', { class: 'person-vol' }, svgIcon('volume'), r);
      if (amOwner()) vol.append(h('button', { class: 'icon-btn kick-btn', type: 'button', title: 'Удалить из звонка', 'aria-label': 'Удалить ' + m.name, onclick: () => kick(m.id) }, svgIcon('userX')));
      li.append(vol);
    }
    ul.append(li);
  }
}
let unread = 0;
function addChat(m) {
  const ul = $('#chatList');
  let li;
  if (m.t === 'sys') li = h('li', { class: 'msg sys' }, h('p', { text: m.text }));
  else {
    const mine = m.from === me.id;
    li = h('li', { class: 'msg' + (mine ? ' mine' : '') }, mine ? null : h('b', { text: cleanName(m.name) }), h('p', { text: String(m.text).slice(0, 500) }));
    const chatOpen = $('#side').classList.contains('open') && !$('[data-pane=chat]').classList.contains('hidden');
    if (!mine && !chatOpen) { unread++; toast(`${cleanName(m.name)}: ${String(m.text).slice(0, 80)}`, { ava: cleanName(m.name), ms: 3500 }); }
  }
  ul.append(li);
  while (ul.children.length > 300) ul.firstChild.remove();
  ul.scrollTop = ul.scrollHeight;
  updateBadge();
}
function updateBadge() { const b = $('#chatBadge'); b.textContent = String(unread); b.classList.toggle('hidden', !unread); }
function openSide(tab) {
  const side = $('#side');
  if (side.classList.contains('open') && side.dataset.tab === tab) { side.classList.remove('open'); return; }
  side.dataset.tab = tab; side.classList.add('open');
  $$('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.side-body').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== tab));
  if (tab === 'chat') { unread = 0; updateBadge(); setTimeout(() => $('#chatInput').focus(), 300); const ul = $('#chatList'); ul.scrollTop = ul.scrollHeight; }
}
// данные встречи и пароля упакованы компактно: #КОД.<base64url(JSON)>
const b64u = str => btoa(String.fromCharCode(...enc(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = str => new TextDecoder().decode(Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
function metaHash(code, sc, pass) {
  const o = {};
  if (sc) { o.t = sc.t; o.d = Math.round((sc.e - sc.t) / 60); if (sc.n) o.n = sc.n; if (sc.z) o.z = sc.z; }
  if (pass && pass.s && pass.v) { o.s = pass.s; o.v = pass.v; }
  return Object.keys(o).length ? code + '.' + b64u(JSON.stringify(o)) : code;
}
function hashFor() { return metaHash(S.code, (S.room && S.room.sched) || Sched.fromMeta(S.meta), S.meta); }
function inviteLink() { return location.origin + location.pathname + '#' + hashFor(); }
// проверочная метка пароля в ссылке: по ней любой, кто первым откроет пустую комнату, вводит тот же пароль
async function passVerifier(key, code) { return (await Crypt.sign(key, 'verify|' + code)).slice(0, 22); }
async function syncPassMeta() {
  if (S.key && S.salt && S.code) { S.meta.s = S.salt; S.meta.v = await passVerifier(S.key, S.code); if (S.inCall) history.replaceState(null, '', '#' + hashFor()); }
}

/* ---------- скрытие панели при бездействии ---------- */
let idleT = 0;
function poke() {
  const call = $('#call'); call.classList.remove('idle');
  clearTimeout(idleT);
  idleT = setTimeout(() => {
    const busy = !$('#moreMenu').classList.contains('hidden') || !$('#endMenu').classList.contains('hidden') || !$('#reactBar').classList.contains('hidden') || $('#side').classList.contains('open') || L.game || S.members.length < 2 || document.querySelector('.tile-pop');
    if (!busy) call.classList.add('idle');
  }, 4000);
}

/* =====================================================================
   ЗАПИСЬ ЗВОНКА И СНИМКИ
   ===================================================================== */
function drawTile(g, t, r, label, rad = 14) {
  const v = t.video;
  const m = t.self ? { name: me.name, cam: M.camOn, screen: !!M.screenTrack } : (memberOf(t.id) || { name: '…' });
  const live = (t.self ? !!(M.screenTrack || M.camOn) : !!(m.cam || m.screen)) && v.readyState >= 2 && v.videoWidth;
  g.save();
  g.beginPath(); rad && g.roundRect ? g.roundRect(r.x, r.y, r.w, r.h, rad) : g.rect(r.x, r.y, r.w, r.h); g.clip();
  g.fillStyle = '#1c1c1e'; g.fillRect(r.x, r.y, r.w, r.h);
  if (live) {
    const vw = v.videoWidth, vh = v.videoHeight, contain = !!m.screen;
    const s = contain ? Math.min(r.w / vw, r.h / vh) : Math.max(r.w / vw, r.h / vh);
    const dw = vw * s, dh = vh * s;
    g.drawImage(v, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh);
  } else {
    const rad = Math.min(r.w, r.h) * .17;
    g.fillStyle = colorFor(m.name); g.beginPath(); g.arc(r.x + r.w / 2, r.y + r.h / 2, rad, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = `600 ${Math.round(rad)}px -apple-system, Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(initial(m.name), r.x + r.w / 2, r.y + r.h / 2 + 1);
  }
  if (label) {
    const name = t.self ? me.name : m.name, k = Math.max(1, r.w / 900);
    g.font = `500 ${Math.round(15 * k)}px -apple-system, Inter, sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle';
    const tw = g.measureText(name).width, bh = 26 * k, bx = r.x + 10 * k, by = r.y + r.h - bh - 10 * k;
    g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.roundRect ? g.roundRect(bx, by, tw + 20 * k, bh, bh / 2) : g.rect(bx, by, tw + 20 * k, bh); g.fill();
    g.fillStyle = '#fff'; g.fillText(name, bx + 10 * k, by + bh / 2);
  }
  g.restore();
}
function compose(g, W, H) {
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const tiles = Tiles.ordered();
  const rects = gridRects(tiles.length, 12, 12, W - 24, H - 24, 10, 16 / 9);
  tiles.forEach((t, i) => drawTile(g, t, rects[i], true));
}
const Rec = {
  active: false, rec: null, chunks: [], canvas: null, timer: 0, dest: null, nodes: new Map(), started: 0, mime: '',
  pickMime() {
    const list = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'];
    return list.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  },
  async start() {
    if (this.active) return;
    if (!window.MediaRecorder) { toast('Этот браузер не умеет записывать видео'); return; }
    await ensureAudioGraph();
    const W = 1280, H = 720;
    this.canvas = h('canvas'); this.canvas.width = W; this.canvas.height = H;
    const g = this.canvas.getContext('2d');
    this.dest = M.ctx.createMediaStreamDestination();
    try { M.gate.connect(this.dest); } catch {}
    for (const [id, r] of M.remotes) if (r.stream) this.addStream(id, r.stream);
    const vs = this.canvas.captureStream(30);
    const stream = new MediaStream([...vs.getVideoTracks(), ...this.dest.stream.getAudioTracks()]);
    this.mime = this.pickMime();
    try { this.rec = new MediaRecorder(stream, this.mime ? { mimeType: this.mime, videoBitsPerSecond: 3000000 } : {}); }
    catch { this.rec = new MediaRecorder(stream); this.mime = this.rec.mimeType; }
    this.chunks = [];
    this.rec.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.onstop = () => this.save();
    this.rec.start(1000);
    this.active = true; this.started = Date.now();
    this.timer = setInterval(() => {
      compose(g, W, H);
      $('#recText').textContent = 'Запись ' + fmtTime((Date.now() - this.started) / 1000);
    }, 1000 / 30);
    send({ t: 'rec', on: true });
    this.ui();
  },
  addStream(id, stream) {
    if (!this.active || !this.dest || this.nodes.has(id) || !stream.getAudioTracks().length) return;
    try { const n = M.ctx.createMediaStreamSource(stream); n.connect(this.dest); this.nodes.set(id, n); } catch {}
  },
  removeStream(id) { const n = this.nodes.get(id); if (n) { try { n.disconnect(); } catch {} this.nodes.delete(id); } },
  stop(silent) {
    if (!this.active) return;
    this.active = false; clearInterval(this.timer);
    try { this.rec.state !== 'inactive' && this.rec.stop(); } catch {}
    try { M.gate.disconnect(this.dest); } catch {}
    for (const id of [...this.nodes.keys()]) this.removeStream(id);
    if (!silent) send({ t: 'rec', on: false });
    this.ui();
  },
  save() {
    if (!this.chunks.length) return;
    const type = (this.mime || this.rec.mimeType || 'video/webm').split(';')[0];
    const blob = new Blob(this.chunks, { type }); this.chunks = [];
    download(blob, `Рядом-запись-${stamp()}.${type.includes('mp4') ? 'mp4' : 'webm'}`);
    toast('Запись сохранена в «Загрузки»', { icon: 'check' });
  },
  ui() {
    const b = $('#recBtn');
    b.classList.toggle('rec-on', this.active);
    b.setAttribute('aria-label', this.active ? 'Остановить запись' : 'Записать звонок');
    b.title = this.active ? 'Остановить запись' : 'Записать звонок';
    onRoom();
  },
};
function snapshot() {
  const tiles = Tiles.ordered(); if (!tiles.length) return;
  const fl = $('#shutterFlash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
  const st = stamp();
  tiles.forEach((t, i) => {
    const v = t.video, live = v.readyState >= 2 && v.videoWidth;
    const w = live ? Math.min(1920, v.videoWidth) : 1280, hh = live ? Math.round(w * v.videoHeight / v.videoWidth) : 720;
    const c = h('canvas'); c.width = w; c.height = hh;
    drawTile(c.getContext('2d'), t, { x: 0, y: 0, w, h: hh }, true, 0);
    const name = (t.self ? me.name : nameOf(t.id)).replace(/[\\/:*?"<>|]+/g, '_');
    c.toBlob(b => { if (b) setTimeout(() => download(b, `Рядом-${name}-${st}.png`), i * 350); }, 'image/png');
  });
  toast(tiles.length > 1 ? `Снимки ${tiles.length} участников сохранены в «Загрузки»` : 'Снимок сохранён в «Загрузки»', { icon: 'shot' });
  send({ t: 'shot' });
}

/* =====================================================================
   ЭКРАНЫ: главная → предпросмотр → звонок
   ===================================================================== */
function parseHash() {
  const raw = decodeURIComponent(location.hash.slice(1)); const i = raw.search(/[.?]/);
  const c = normCode(i < 0 ? raw : raw.slice(0, i));
  const meta = {};
  if (i >= 0 && raw[i] === '.') {
    let o = null; try { o = JSON.parse(unb64u(raw.slice(i + 1, i + 2000))); } catch {}
    if (o && typeof o === 'object') {
      const sc = Sched.clean({ n: o.n, t: o.t, e: +o.t + Math.round(+o.d) * 60, z: o.z });
      if (sc) Object.assign(meta, sc);
      if (typeof o.s === 'string' && typeof o.v === 'string' && /^[A-Za-z0-9+/=]{8,64}$/.test(o.s) && /^[A-Za-z0-9+/=]{8,64}$/.test(o.v)) { meta.s = o.s; meta.v = o.v; }
    }
  }
  return { code: isCode(c) ? c : null, meta };
}
function codeFromHash() { return parseHash().code; }
function renderHome() {
  const code = codeFromHash();
  $('#nameInput').value = me.name;
  $('#inviteBox').classList.toggle('hidden', !code);
  $('#joinBlock').classList.toggle('hidden', !code);
  $('#createBlock').classList.toggle('hidden', !!code);
  if (code) $('#inviteCode').textContent = fmtCode(code);
  Sched.renderInvite(code ? parseHash().meta : null);
  $('#cardTitle').textContent = code ? 'Как вас представить?' : 'Начать звонок';
  $('#home').classList.toggle('invited', !!code);
  show('home');
}
function takeName() {
  const v = cleanName($('#nameInput').value);
  if (!$('#nameInput').value.trim()) { const i = $('#nameInput'); i.focus(); i.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 300, easing: 'ease-out' }); return false; }
  me.name = v; ls.set('name', v); return true;
}
async function goPreview(mode, code) {
  if (!takeName()) return;
  S.mode = mode; S.code = code;
  S.meta = mode === 'join' && code === codeFromHash() ? parseHash().meta : (S.meta && S.meta._for === code ? S.meta : {});
  S.meta._for = code;
  S.createPass = mode === 'create' && !$('#passRow').classList.contains('hidden') ? $('#createPass').value : '';
  $('#pvTitle').textContent = mode === 'create' ? 'Новый звонок' : (S.meta.n || 'Комната ' + fmtCode(code));
  $('#pvSub').textContent = mode === 'create' ? (S.createPass ? 'Комната будет с паролем.' : 'После входа отправьте друзьям ссылку.') : 'Проверьте камеру и звук перед входом.';
  $('#pvJoin').disabled = false; $('#pvJoin').textContent = 'Войти';
  show('preview');
  renderPreview();
  // если доступ уже выдан раньше, окно браузера не появится — можно включить сразу
  let granted = false;
  try { const [a, b] = await Promise.all([navigator.permissions.query({ name: 'microphone' }), navigator.permissions.query({ name: 'camera' })]); granted = a.state === 'granted' && b.state === 'granted'; } catch {}
  if (M.asked || granted) { $('#pvAsk').classList.add('hidden'); if (!M.raw && !M.camTrack) { await requestDevices(true); } renderPreview(); }
  else { $('#pvAsk').classList.remove('hidden'); await fillDevices(); }
}
function renderPreview() {
  const v = $('#pvVideo');
  const want = M.camOn ? M.camTrack : null;
  if ((v._t || null) !== want) { v._t = want; v.srcObject = want ? new MediaStream([want]) : null; if (want) v.play().catch(() => {}); }
  v.classList.toggle('mirrored', M.mirror);
  $('#pvPlaceholder').classList.toggle('hidden', !!want);
  const ava = $('#pvAva'); ava.textContent = initial(me.name);
  const mic = $('#pvMic'), cam = $('#pvCam');
  setIcon(mic, micLive() ? 'mic' : 'micOff'); mic.classList.toggle('off', !micLive());
  setIcon(cam, M.camOn ? 'cam' : 'camOff'); cam.classList.toggle('off', !M.camOn);
  $('#pvMirror').classList.toggle('active', M.mirror);
  $('#pvDenied').classList.toggle('hidden', !M.denied);
}
async function allowDevices() {
  $('#pvAllow').disabled = true;
  const ok = await requestDevices(true);
  $('#pvAllow').disabled = false;
  $('#pvAsk').classList.add('hidden');
  if (!ok) toast('Доступа нет — вы войдёте в режиме «только слушать»', { icon: 'micOff', ms: 4000 });
  renderPreview();
}

async function startCall() {
  const btn = $('#pvJoin'); btn.disabled = true; btn.textContent = 'Подключение…';
  try {
    if (!M.asked) { $('#pvAsk').classList.add('hidden'); await requestDevices(true); renderPreview(); }
    await ensureAudioGraph();
    if (!M.raw) M.micOn = false;
    replaceVideo(currentVideoTrack());
    S.leaving = false; S.inCall = false; S.aloneClosed = false; S.members = []; S.room = null; S.hub = null; S.conn = null; S.reconnecting = false;
    me.joined = Date.now();
    if (S.mode === 'create') {
      S.salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
      S.key = S.createPass ? await Crypt.deriveKey(S.createPass, S.salt) : null;
    } else {
      S.key = null; S.salt = null;
      if (S.meta.e && Date.now() > S.meta.e * 1000) { leave('expired'); return; }
      if (S.preset && S.preset.code === S.code) { S.key = S.preset.key; S.salt = S.preset.salt; }
      else if (S.meta.s && S.meta.v) {
        // пароль из ссылки: проверяем локально, по сети он не уходит
        let wrong = false;
        for (;;) {
          const pw = await askPassword(wrong);
          if (pw == null) { closePassword(); btn.disabled = false; btn.textContent = 'Войти'; return; }
          const k = await Crypt.deriveKey(pw, S.meta.s);
          if (await passVerifier(k, S.code) === S.meta.v) { S.key = k; S.salt = S.meta.s; closePassword(); break; }
          wrong = true;
        }
      }
    }
    S.peer = await createPeer();
    me.id = S.peer.id;
    if (S.mode === 'create') {
      for (let i = 0; i < 3; i++) {
        S.code = S.code || genCode(); S.roomId = await hubIdFor(S.code);
        try { await becomeHub(); break; }
        catch (e) { if (e && e.type === 'unavailable-id') { S.code = null; continue; } throw e; }
      }
    } else S.roomId = await hubIdFor(S.code);
    syncPassMeta();
    await ensureConnected(false);
  } catch (e) {
    console.error(e);
    toast('Нет связи с сигнальным сервером. Проверьте интернет.', { ms: 5000 });
    cleanupConnection();
    btn.disabled = false; btn.textContent = 'Войти';
  }
}
function enterCall() {
  S.inCall = true;
  history.replaceState(null, '', '#' + hashFor());
  syncPassMeta();
  $('#roomCode').textContent = fmtCode(S.code);
  $('#aloneCode').textContent = fmtCode(S.code);
  show('call');
  Tiles.sync(); Tiles.refreshSelf(); updateControls(); updateTopbar(); onRoom(); layout();
  setConn(true); poke();
  $('#screenBtn').classList.toggle('hidden', !(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) || IS_TOUCH);
  $('#shareBtn').classList.toggle('hidden', !navigator.share);
  if (M.denied || !M.raw) toast('Вы в режиме «только слушать»', { icon: 'micOff' });
}
function cleanupConnection(slowHub) {
  clearInterval(S.pingTimer);
  for (const c of M.calls.values()) { try { c.close(); } catch {} }
  M.calls.clear();
  for (const id of [...M.remotes.keys()]) dropRemote(id);
  try { S.conn && S.conn.close(); } catch {}
  if (S.hub) { const hb = S.hub; if (slowHub) setTimeout(() => hb.destroy(), 1500); else hb.destroy(); } // дать «завершено» дойти до всех
  const pr = S.peer;
  try { pr && (slowHub ? setTimeout(() => pr.destroy(), 1600) : pr.destroy()); } catch {}
  S.conn = null; S.hub = null; S.peer = null; S.connected = false;
}
function leave(reason, by) {
  if (S.leaving && reason !== 'force') return;
  S.leaving = true;
  closePassword(); closeMenus(); $('#side').classList.remove('open');
  Rec.stop(true);
  stopScreen();
  Games.reset();
  Cinema.reset();
  cleanupConnection(reason === 'ended');
  for (const t of Tiles.map.values()) t.el.remove();
  Tiles.map.clear(); Tiles.screenSeen = {};
  S.members = []; L.pinned = null; L.game = false; L.cine = false;
  $('#chatList').replaceChildren(); unread = 0; updateBadge();
  const wasIn = S.inCall; S.inCall = false;
  if (M.camTrack) { M.camTrack.stop(); M.camTrack = null; M.camOn = false; }
  if (M.raw) { M.raw.getTracks().forEach(t => t.stop()); M.raw = null; }
  M.asked = false;
  if (reason === 'cancel') { renderHome(); return; }
  const [title, text] = reason === 'self' ? ['Вы вышли из звонка', 'Можно вернуться по той же ссылке, пока в комнате кто-то есть.']
    : reason === 'ended' ? ['Звонок завершён', by ? `${by} завершает звонок для всех.` : 'Организатор завершил звонок.']
    : reason === 'neterr' ? ['Не удалось подключиться', 'Проверьте интернет. Если сеть строгая (офис, часть мобильных операторов), без TURN-сервера звонок может не соединиться.']
    : DENY_TEXT[reason] || ['Звонок завершён', ''];
  $('#endedTitle').textContent = title; $('#endedText').textContent = text;
  $('#rejoinBtn').classList.toggle('hidden', ['kicked', 'ended', 'time', 'expired'].includes(reason) || !S.code);
  $('#rejoinBtn').textContent = wasIn ? 'Вернуться в звонок' : 'Попробовать снова';
  show('ended');
}

/* =====================================================================
   ОБРАБОТЧИКИ
   ===================================================================== */
function bind() {
  paintIcons();
  // главная
  $('#createBtn').onclick = () => goPreview('create', null);
  $('#passToggle').onclick = () => {
    const row = $('#passRow'), hidden = row.classList.toggle('hidden');
    $('#passToggle span:last-child').textContent = hidden ? 'Добавить пароль' : 'Без пароля';
    if (!hidden) setTimeout(() => $('#createPass').focus(), 50); else $('#createPass').value = '';
  };
  const ci = $('#codeInput');
  ci.oninput = () => { const c = normCode(ci.value).slice(0, 8); ci.value = c.length > 4 ? c.slice(0, 4) + '-' + c.slice(4) : c; };
  const joinByCode = () => {
    const c = normCode(ci.value);
    if (!isCode(c)) { toast('Код — 8 символов, например ABCD-2345'); ci.focus(); return; }
    location.hash = c; goPreview('join', c);
  };
  $('#codeBtn').onclick = joinByCode;
  ci.addEventListener('keydown', e => { if (e.key === 'Enter') joinByCode(); });
  $('#nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') { const c = codeFromHash(); c ? goPreview('join', c) : goPreview('create', null); } });
  $('#joinInviteBtn').onclick = () => goPreview('join', codeFromHash());
  $('#ownRoomBtn').onclick = () => { history.replaceState(null, '', location.pathname); renderHome(); };
  addEventListener('hashchange', () => { if (!S.inCall && !$('#home').classList.contains('hidden')) renderHome(); });

  // предпросмотр
  $('#pvBack').onclick = () => { if (M.camTrack) { M.camTrack.stop(); M.camTrack = null; M.camOn = false; } if (M.raw) { M.raw.getTracks().forEach(t => t.stop()); M.raw = null; } M.asked = false; renderPreview(); renderHome(); };
  $('#pvAllow').onclick = allowDevices;
  $('#pvSkip').onclick = () => { M.asked = true; M.denied = true; M.micOn = false; $('#pvAsk').classList.add('hidden'); renderPreview(); };
  $('#pvMic').onclick = async () => { if (!M.raw) { $('#pvAsk').classList.add('hidden'); await openMic(ls.get('micId', '')); } else M.micOn = !M.micOn; renderPreview(); };
  $('#pvCam').onclick = async () => { $('#pvAsk').classList.add('hidden'); await setCam(!M.camOn); renderPreview(); };
  $('#pvMirror').onclick = () => setMirror(!M.mirror);
  $('#pvJoin').onclick = startCall;
  const onMicSel = async e => { ls.set('micId', e.target.value); if (M.raw || M.asked) await openMic(e.target.value); };
  const onCamSel = async e => { await switchCamera(e.target.value); renderPreview(); };
  const onSpkSel = e => { ls.set('spkId', e.target.value); for (const t of Tiles.map.values()) if (!t.self) applySink(t.video); };
  $('#pvMicSel').onchange = onMicSel; $('#setMic').onchange = onMicSel;
  $('#pvCamSel').onchange = onCamSel; $('#setCam').onchange = onCamSel;
  $('#pvSpkSel').onchange = onSpkSel; $('#setSpk').onchange = onSpkSel;
  navigator.mediaDevices && navigator.mediaDevices.addEventListener && navigator.mediaDevices.addEventListener('devicechange', () => fillDevices());

  // пароль
  $('#pwForm').onsubmit = e => {
    e.preventDefault();
    const v = $('#pwInput').value; if (!v) return;
    $('#pwInput').disabled = true; $('#pwForm button[type=submit]').disabled = true; $('#pwErr').classList.add('hidden');
    const r = pwResolve; pwResolve = null; r && r(v);
  };
  $('#pwCancel').onclick = () => { const r = pwResolve; closePassword(); r && r(null); };

  // управление звонком
  const mic = $('#micBtn');
  mic.addEventListener('click', async () => {
    if (M.ptt && M.raw) return;
    if (!M.raw) { await openMic(ls.get('micId', '')); return; }
    M.micOn = !M.micOn; updateControls(); sendStatus(); renderPeople();
  });
  mic.addEventListener('pointerdown', () => { if (M.ptt && M.raw) { M.micOn = true; M.pttDown = true; } });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => mic.addEventListener(ev, () => { if (M.ptt) M.pttDown = false; }));
  $('#camBtn').onclick = () => setCam(!M.camOn);
  $('#screenBtn').onclick = toggleScreen;
  $('#recBtn').onclick = () => Rec.active ? Rec.stop() : Rec.start();
  $('#shotBtn').onclick = snapshot;
  $('#reactBtn').onclick = e => {
    e.stopPropagation();
    const bar = $('#reactBar'), open = bar.classList.contains('hidden');
    closeMenus('#reactBar'); bar.classList.toggle('hidden', !open); $('#reactBtn').classList.toggle('active', open);
  };
  const bar = $('#reactBar');
  for (const e of REACTIONS) bar.append(h('button', { type: 'button', 'aria-label': 'Реакция ' + e, text: e, onclick: ev => { ev.stopPropagation(); FX.emoji(e, me.name); send({ t: 'react', e }); } }));
  $('#gamePill').onclick = () => Games.show();
  const popMenu = (btnSel, menuSel) => {
    const menu = $(menuSel), btn = $(btnSel), open = menu.classList.contains('hidden');
    closeMenus(menuSel);
    if (!open) { menu.classList.add('hidden'); return; }
    menu.classList.remove('hidden');
    const r = btn.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(innerWidth - mw - 8, r.left + r.width / 2 - mw / 2)) + 'px';
    menu.style.top = Math.max(8, r.top - mh - 12) + 'px';
  };
  $('#moreBtn').onclick = e => { e.stopPropagation(); popMenu('#moreBtn', '#moreMenu'); };
  $('#gameBtn').onclick = e => { e.stopPropagation(); popMenu('#gameBtn', '#funMenu'); };
  $('#funMenu').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return; e.stopPropagation(); closeMenus();
    if (b.dataset.act === 'game') Games.toggleRoom(); else if (b.dataset.act === 'cine') Cinema.toggle();
  });
  $('#endBtn').onclick = e => { e.stopPropagation(); popMenu('#endBtn', '#endMenu'); };
  $('#moreMenu').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return; e.stopPropagation();
    const a = b.dataset.act;
    if (a !== 'mirror') closeMenus();
    if (a === 'game') Games.toggleRoom();
    else if (a === 'cine') Cinema.toggle();
    else if (a === 'layout') { L.mode = L.mode === 'pip' ? 'side' : 'pip'; ls.set('layout', L.mode); L.swap = false; layout(); }
    else if (a === 'mirror') setMirror(!M.mirror);
    else if (a === 'people') openSide('people');
    else if (a === 'chat') openSide('chat');
    else if (a === 'settings') openSettings();
    else if (a === 'about') $('#about').classList.remove('hidden');
  });
  $('#endMenu').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return; e.stopPropagation(); closeMenus();
    if (b.dataset.act === 'leave') leave('self');
    else if (b.dataset.act === 'endall' && amOwner()) { if (confirm('Завершить звонок для всех участников?')) send({ t: 'end' }); }
  });
  document.addEventListener('click', e => { if (!e.target.closest('.menu, .react-bar, .tile-pop, #moreBtn, #endBtn, #reactBtn, #gameBtn')) closeMenus(); });

  // верх
  $('#codePill').onclick = () => copyText(inviteLink(), 'Ссылка-приглашение скопирована');
  $('#copyLinkBtn').onclick = () => copyText(inviteLink(), 'Ссылка-приглашение скопирована');
  $('#shareBtn').onclick = () => navigator.share({ title: 'Рядом', text: `Заходи в звонок, код ${fmtCode(S.code)}`, url: inviteLink() }).catch(() => {});
  $('#peoplePill').onclick = () => openSide('people');
  $('#sideClose').onclick = () => $('#side').classList.remove('open');
  $$('.seg-btn').forEach(b => b.onclick = () => { $('#side').dataset.tab = ''; openSide(b.dataset.tab); });
  $('#lockBtn').onclick = () => { if (amOwner()) send({ t: 'lock', on: !(S.room && S.room.locked) }); };
  $('#chatForm').onsubmit = e => { e.preventDefault(); const i = $('#chatInput'); const v = i.value.trim(); if (!v) return; send({ t: 'chat', text: v.slice(0, 500) }); i.value = ''; };
  $('#aloneClose').onclick = () => { S.aloneClosed = true; layout(); };
  $('#tapAudio').onclick = () => { for (const t of Tiles.map.values()) if (!t.self) t.video.play().catch(() => {}); M.ctx && M.ctx.resume(); $('#tapAudio').classList.add('hidden'); };

  // окна
  $$('[data-open]').forEach(b => b.onclick = () => $('#' + b.dataset.open).classList.remove('hidden'));
  $$('.modal').forEach(m => m.addEventListener('click', e => { if ((e.target === m || e.target.closest('[data-close]')) && m.id !== 'pwModal') m.classList.add('hidden'); }));
  $('#gateRange').oninput = e => { M.gateDb = +e.target.value; ls.set('gateDb', M.gateDb); renderGate(); };
  $('#voiceRange').oninput = e => { M.voiceVol = +e.target.value; ls.set('voiceVol', M.voiceVol); $('#voiceVal').textContent = Math.round(M.voiceVol * 100) + '%'; for (const id of M.remotes.keys()) applyVol(id); };
  $('#pttSwitch').onclick = () => { M.ptt = !M.ptt; ls.set('ptt', M.ptt); if (M.ptt) M.micOn = true; $('#pttSwitch').setAttribute('aria-checked', String(M.ptt)); updateControls(); sendStatus(); };
  $('#mirrorSwitch').onclick = () => setMirror(!M.mirror);

  // клавиатура
  const typing = e => e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
  addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeMenus(); $$('.modal:not(#pwModal)').forEach(m => m.classList.add('hidden')); $('#side').classList.remove('open'); }
    if (!S.inCall || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'KeyV' && M.ptt && !e.repeat) { M.micOn = true; M.pttDown = true; }
    if (e.code === 'KeyM' && !e.repeat && !M.ptt && M.raw) { M.micOn = !M.micOn; updateControls(); sendStatus(); }
  });
  addEventListener('keyup', e => { if (e.code === 'KeyV') M.pttDown = false; });
  addEventListener('blur', () => { M.pttDown = false; });

  // бездействие
  ['pointermove', 'pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, () => { if (S.inCall) poke(); }, { passive: true }));
  addEventListener('pagehide', () => { try { S.peer && S.peer.destroy(); } catch {} if (S.hub) S.hub.destroy(); });
}
function renderGate() {
  $('#gateRange').value = M.gateDb;
  $('#gateMark').style.left = ((M.gateDb + 80) / 60 * 100) + '%';
  $('#gateVal').textContent = M.gateDb + ' дБ';
}
function openSettings() {
  renderGate();
  $('#voiceRange').value = M.voiceVol; $('#voiceVal').textContent = Math.round(M.voiceVol * 100) + '%';
  $('#pttSwitch').setAttribute('aria-checked', String(M.ptt));
  $('#mirrorSwitch').setAttribute('aria-checked', String(M.mirror));
  $('#iosVolHint').classList.toggle('hidden', !IS_IOS);
  fillDevices();
  $('#settings').classList.remove('hidden');
}

window.addEventListener('DOMContentLoaded', () => {
  bind();
  $('[data-act=mirror]').classList.toggle('on', M.mirror);
  $('#rejoinBtn').onclick = () => { S.leaving = false; goPreview(S.mode === 'create' ? 'join' : S.mode, S.code); };
  $('#homeBtn').onclick = () => { history.replaceState(null, '', location.pathname); S.code = null; renderHome(); };
  if (!window.Peer) toast('Не загрузилась библиотека связи. Проверьте интернет и обновите страницу.', { ms: 8000 });
  renderHome();
});
