'use strict';
/* =====================================================================
   ИГРОВАЯ КОМНАТА. Открыл один — у всех появляется экран ожидания.
   Состоянием игры управляет «ведущий» (тот, кто открыл комнату; если
   он уходит — следующий игрок). Сообщения идут через hub комнаты.
   Игры: Сулифа (камень-ножницы-бумага, можно жестом), Баскетбол, Реакция.
   ===================================================================== */
const GAME_SVG = {
  rock: '<path d="M6.5 14.5c-1.6-1.2-2-3.4-1-5.2.9-1.6 2.7-2.4 4.4-2.1 1.2-1.3 3.4-1.6 5-.6 1.9.1 3.4 1.6 3.6 3.5 1 1.2 1.1 3 .2 4.3-.9 2.6-3.5 4.3-6.4 4.1-2.5-.1-4.7-1.6-5.8-4z"/><path d="M9.6 7.2c.6 1 .7 2.1.4 3.2M14.6 6.6c.2 1.1 0 2.2-.6 3.1"/>',
  paper: '<rect x="6" y="3.5" width="12" height="17" rx="2.2"/><path d="M9 8h6M9 11h6M9 14h4"/>',
  scissors: '<circle cx="7" cy="17.2" r="2.7"/><circle cx="17" cy="17.2" r="2.7"/><path d="M8.9 15.3L16.2 3.8M15.1 15.3L7.8 3.8"/>',
  ball: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5v17M6.2 5.8c2.3 1.8 3.5 4 3.5 6.2s-1.2 4.4-3.5 6.2M17.8 5.8c-2.3 1.8-3.5 4-3.5 6.2s1.2 4.4 3.5 6.2"/>',
  bolt: '<path d="M13.2 3L5.5 13.4h5.7L10.3 21l8.2-10.6h-5.9z"/>',
};
const gsvg = (name, size) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'game-svg'); s.setAttribute('aria-hidden', 'true'); if (size) { s.style.width = size + 'px'; s.style.height = size + 'px'; } s.innerHTML = GAME_SVG[name]; return s; };
const RPS = { rock: 'Камень', scissors: 'Ножницы', paper: 'Бумага' };
const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const GAME_TITLES = { rps: 'Сулифа', ball: 'Баскетбол', react: 'Реакция' };

const Games = (() => {
  let s = null;          // общее состояние комнаты
  let A = null;          // рабочая копия у ведущего
  let secret = {};       // тайные ходы (только у ведущего)
  let visible = false, renderedKey = '', myPick = null, myTap = null;
  let leaderTimer = 0, ticker = 0, publishT = 0, ballGame = null;

  const isLeader = () => !!(s && s.open && s.leader === me.id);
  const isPlayer = (id = me.id) => !!(s && s.players.includes(id));
  const sendG = (d, to) => send(to ? { t: 'g', d, to } : { t: 'g', d });
  const req = (a, extra) => { if (s && s.open) sendG({ k: 'req', a, ...(extra || {}) }, s.leader); };
  const clone = o => JSON.parse(JSON.stringify(o));
  const publish = () => { if (A) { A.v = (A.v || 0) + 1; sendG({ k: 'state', s: A }); } };
  const publishSoon = () => { if (!publishT) publishT = setTimeout(() => { publishT = 0; publish(); }, 350); };
  const atHub = (t, fn) => { clearTimeout(leaderTimer); leaderTimer = setTimeout(fn, Math.max(0, t - hubNow())); };

  function sanitize(x) {
    if (!x || typeof x !== 'object') return null;
    const ids = a => Array.isArray(a) ? a.filter(v => typeof v === 'string').slice(0, 8) : [];
    return {
      open: !!x.open, leader: String(x.leader || ''), players: ids(x.players),
      game: ['rps', 'ball', 'react'].includes(x.game) ? x.game : null,
      phase: ['lobby', 'count', 'play', 'result'].includes(x.phase) ? x.phase : 'lobby',
      scores: x.scores && typeof x.scores === 'object' ? x.scores : {}, data: x.data && typeof x.data === 'object' ? x.data : {}, v: +x.v || 0,
    };
  }

  /* ---------- сообщения ---------- */
  function onMsg(from, d) {
    if (!d || typeof d !== 'object') return;
    if (d.k === 'state') {
      const ns = sanitize(d.s); if (!ns) return;
      const allowed = ns.leader === from || (s && s.open && s.leader === from);
      if (!allowed) return;
      apply(ns);
    } else if (d.k === 'req' && isLeader()) handleReq(from, d);
  }

  function apply(ns) {
    const prev = s;
    if (!ns.open) { closeLocal(prev && prev.open && prev.leader !== me.id ? 'Игровая комната закрыта' : null); return; }
    s = ns;
    if (s.leader === me.id) { if (!A || A.leader !== me.id || A.v < s.v) A = clone(s); } else A = null;
    if (!prev || !prev.open) {
      visible = true;
      if (s.leader !== me.id) { toast(`${nameOf(s.leader)} открывает игровую комнату`, { icon: 'game' }); chime(true); }
    }
    if (prev && (prev.phase !== s.phase || prev.game !== s.game)) { myPick = null; myTap = null; }
    Gest.hook = s.game === 'rps' && s.phase === 'count' && isPlayer() ? onGesture : null;
    Gest.sync();
    render();
  }

  function closeLocal(msg) {
    s = null; A = null; secret = {}; visible = false; renderedKey = '';
    clearTimeout(leaderTimer); clearInterval(ticker); ticker = 0;
    stopBall(); Gest.hook = null; Gest.sync();
    $('#gameLayer').classList.add('hidden'); $('#gameLayer').replaceChildren();
    $('#gamePill').classList.add('hidden'); $('#gameBtn').classList.remove('active');
    L.game = false; layout();
    if (msg) toast(msg, { icon: 'game' });
  }

  /* ---------- ведущий ---------- */
  function handleReq(from, d) {
    if (!A || !memberOf(from)) return;
    const player = A.players.includes(from);
    switch (d.a) {
      case 'join':
        if (!player && A.players.length < 8) { A.players.push(from); A.scores[from] = A.scores[from] || 0; publish(); }
        break;
      case 'leave':
        if (!player) return;
        A.players = A.players.filter(x => x !== from);
        if (!A.players.length) { A.open = false; publish(); return; }
        if (from === A.leader) { A.leader = A.players[0]; publish(); return; }
        publish(); break;
      case 'close': if (from === A.leader) { A.open = false; publish(); } break;
      case 'lobby': if (player && A.phase !== 'count') { clearTimeout(leaderTimer); A.phase = 'lobby'; A.game = null; A.data = {}; publish(); } break;
      case 'start': if (player) startGame(String(d.game)); break;
      case 'pick':
        if (player && A.game === 'rps' && A.phase === 'count' && RPS[d.v] && hubNow() < A.data.endsAt + 800) {
          secret.picks = secret.picks || {}; secret.picks[from] = d.v;
          A.data.ready = Object.keys(secret.picks); publishSoon();
        }
        break;
      case 'score':
        if (player && A.game === 'ball' && A.phase === 'play' && hubNow() < A.data.endsAt + 1500) {
          A.data.pts[from] = Math.max(0, Math.min(999, Math.floor(+d.n || 0))); publishSoon();
        }
        break;
      case 'tap':
        if (player && A.game === 'react' && A.phase === 'play' && !(from in A.data.taps)) {
          A.data.taps[from] = Math.max(-9999, Math.min(9999, Math.round(+d.rt || 0)));
          if (A.players.every(id => id in A.data.taps || !memberOf(id))) resolveReact(); else publishSoon();
        }
        break;
    }
  }
  function startGame(game) {
    if (!['rps', 'ball', 'react'].includes(game) || A.phase === 'count' || A.phase === 'play') return;
    if (game === 'rps' && A.players.length < 2) return;
    clearTimeout(leaderTimer); secret = {};
    A.game = game;
    const now = hubNow();
    if (game === 'rps') { A.phase = 'count'; A.data = { endsAt: now + 3800, ready: [] }; atHub(A.data.endsAt + 700, resolveRps); }
    if (game === 'ball') { A.phase = 'play'; A.data = { startAt: now + 3500, endsAt: now + 3500 + 40000, pts: Object.fromEntries(A.players.map(id => [id, 0])) }; atHub(A.data.endsAt + 900, resolveBall); }
    if (game === 'react') { const go = now + 2200 + 1500 + Math.random() * 3500; A.phase = 'play'; A.data = { goAt: go, taps: {} }; atHub(go + 3500, resolveReact); }
    publish();
  }
  function win(ids) { for (const id of ids) A.scores[id] = (A.scores[id] || 0) + 1; }
  function resolveRps() {
    if (!A || A.game !== 'rps' || A.phase !== 'count') return;
    const picks = {}; for (const [id, v] of Object.entries(secret.picks || {})) if (A.players.includes(id)) picks[id] = v;
    const kinds = new Set(Object.values(picks));
    let winners = [], outcome = 'draw';
    if (Object.keys(picks).length < 2) outcome = 'few';
    else if (kinds.size === 2) { const [a, b] = [...kinds]; const w = BEATS[a] === b ? a : b; winners = Object.keys(picks).filter(id => picks[id] === w); outcome = 'win'; }
    win(winners);
    A.phase = 'result'; A.data = { picks, winners, outcome }; secret = {};
    publish();
  }
  function resolveBall() {
    if (!A || A.game !== 'ball' || A.phase !== 'play') return;
    const pts = A.data.pts || {}; const max = Math.max(0, ...Object.values(pts));
    const winners = max > 0 ? Object.keys(pts).filter(id => pts[id] === max) : [];
    win(winners);
    A.phase = 'result'; A.data = { pts, winners }; publish();
  }
  function resolveReact() {
    if (!A || A.game !== 'react' || A.phase !== 'play') return;
    clearTimeout(leaderTimer);
    const taps = A.data.taps || {};
    const ok = Object.entries(taps).filter(([, v]) => v >= 0).sort((a, b) => a[1] - b[1]);
    const winners = ok.length ? [ok[0][0]] : [];
    win(winners);
    A.phase = 'result'; A.data = { taps, winners }; publish();
  }

  function onMembers() {
    if (!s || !s.open) return;
    if (!memberOf(s.leader)) {
      const next = s.players.find(id => memberOf(id));
      if (!next) { if (S.members[0] && S.members[0].id === me.id) { A = clone(s); A.leader = me.id; A.open = false; publish(); } else if (!S.members.length) closeLocal(); return; }
      if (next === me.id) {
        A = clone(s); A.leader = me.id; A.players = A.players.filter(id => memberOf(id));
        if (A.phase === 'count' || A.phase === 'play') { A.phase = 'lobby'; A.game = null; A.data = {}; }
        publish();
      }
      return;
    }
    if (isLeader() && A) {
      const alive = A.players.filter(id => memberOf(id));
      if (alive.length !== A.players.length) { A.players = alive; publish(); }
      else publishSoon(); // новичку — текущее состояние
    }
  }

  /* ---------- действия игрока ---------- */
  function toggleRoom() {
    if (!S.inCall) return;
    if (!s || !s.open) {
      A = { open: true, leader: me.id, players: [me.id], game: null, phase: 'lobby', scores: { [me.id]: 0 }, data: {}, v: 0 };
      publish(); return;
    }
    visible = !visible; render();
  }
  function onGesture(cat) {
    const v = { Closed_Fist: 'rock', Open_Palm: 'paper', Victory: 'scissors' }[cat];
    if (v && s && s.phase === 'count') pick(v, true);
  }
  function pick(v, byGesture) {
    if (!isPlayer() || myPick === v) return;
    myPick = v; req('pick', { v });
    if (byGesture) toast('Жест распознан: ' + RPS[v], { icon: 'hand', ms: 1400 });
    updateLive();
  }
  function tap() {
    if (!s || s.game !== 'react' || s.phase !== 'play' || !isPlayer() || myTap != null) return;
    myTap = Math.round(hubNow() - s.data.goAt);
    req('tap', { rt: myTap });
    updateLive();
  }

  /* ---------- отрисовка ---------- */
  function chipsFor(ids, scoreFn) {
    return h('div', { class: 'chips' }, ids.map(id => h('span', { class: 'chip' }, avatar(nameOf(id)), id === me.id ? 'Вы' : nameOf(id), scoreFn ? h('b', { text: String(scoreFn(id)) }) : null)));
  }
  function btn(text, cls, fn, icon) { return h('button', { class: 'btn ' + cls, type: 'button', onclick: fn }, icon ? svgIcon(icon) : null, h('span', { text })); }
  function standings(entries, fmt) {
    const box = h('div', { class: 'standings' });
    entries.forEach(([id, v], i) => box.append(h('div', { class: 'score-row' + (id === me.id ? ' me' : '') }, h('b', { text: String(i + 1) }), avatar(nameOf(id)), h('span', { text: id === me.id ? 'Вы' : nameOf(id) }), h('b', { text: fmt(v) }))));
    return box;
  }
  function resultTitle(winners, noneText) {
    if (!winners.length) return noneText;
    if (winners.includes(me.id) && winners.length === 1) return 'Вы победили!';
    return 'Победа: ' + winners.map(id => id === me.id ? 'вы' : nameOf(id)).join(', ');
  }

  function render() {
    const layer = $('#gameLayer');
    const on = !!(s && s.open);
    $('#gamePill').classList.toggle('hidden', !on || visible);
    $('#gameBtn').classList.toggle('active', on);
    if (on) $('#gamePillText').textContent = (s.game && s.phase !== 'lobby' ? GAME_TITLES[s.game] : 'Игровая комната') + ' · ' + s.players.length;
    if (!on || !visible) { layer.classList.add('hidden'); if (L.game) { L.game = false; layout(); } stopTicker(); if (!on) stopBall(); return; }
    layer.classList.remove('hidden');
    if (!L.game) { L.game = true; layout(); }
    const key = [s.phase, s.game, s.data.endsAt || s.data.goAt || '', isPlayer(), s.leader === me.id].join('|');
    if (key !== renderedKey || !layer.firstChild) { renderedKey = key; build(layer); }
    updateLive();
    if ((s.phase === 'count' || s.phase === 'play') && !ticker) ticker = setInterval(updateLive, 100);
    if (!(s.phase === 'count' || s.phase === 'play')) stopTicker();
  }
  function stopTicker() { clearInterval(ticker); ticker = 0; }

  function build(layer) {
    if (!(s.game === 'ball' && s.phase === 'play')) stopBall();
    const title = s.phase === 'lobby' || !s.game ? 'Игровая комната' : GAME_TITLES[s.game];
    const head = h('div', { class: 'game-head' }, svgIcon('game'), h('h3', { text: title }));
    if (isPlayer()) head.append(h('button', { class: 'icon-btn', type: 'button', title: 'Выйти из игры', 'aria-label': 'Выйти из игры', onclick: () => { req('leave'); } }, svgIcon('leave')));
    head.append(h('button', { class: 'icon-btn', type: 'button', title: 'Свернуть', 'aria-label': 'Свернуть игровую комнату', onclick: () => { visible = false; render(); } }, svgIcon('close')));
    const body = h('div', { class: 'game-body' });
    const card = h('div', { class: 'game-card glass-strong' }, head, body);
    layer.replaceChildren(card);

    if (s.phase === 'lobby') {
      body.append(h('h2', { class: 'title', text: s.players.length < 2 ? 'Ждём игроков' : 'Во что играем?' }));
      const live = h('div', { class: 'live-players' }); body.append(live);
      if (s.players.length < 2) body.append(h('div', { class: 'waiting' }, 'Пусть друзья нажмут «Присоединиться»', h('i', { text: '.' }), h('i', { text: '.' }), h('i', { text: '.' })));
      if (isPlayer()) {
        const grid = h('div', { class: 'games-grid' });
        const card = (g, icon, name, sub, min) => {
          const b = h('button', { class: 'game-pick', type: 'button', 'data-min': String(min), onclick: () => req('start', { game: g }) }, gsvg(icon), h('strong', { text: name }), h('span', { text: sub }));
          return b;
        };
        grid.append(
          card('rps', 'scissors', 'Сулифа', 'Камень, ножницы, бумага. Можно показать жестом в камеру.', 2),
          card('ball', 'ball', 'Баскетбол', '40 секунд: смахните мяч в кольцо. Кто больше?', 1),
          card('react', 'bolt', 'Реакция', 'Нажмите, как только экран станет зелёным.', 1));
        body.append(grid);
        if (s.leader === me.id) body.append(h('button', { class: 'link-btn subtle', type: 'button', onclick: () => req('close') }, h('span', { text: 'Закрыть игровую комнату для всех' })));
      } else {
        body.append(h('p', { class: 'muted', text: `${nameOf(s.leader)} зовёт поиграть. Звонок продолжается.` }));
        body.append(h('div', { class: 'row-gap' }, btn('Присоединиться', 'btn-primary', () => req('join')), btn('Не сейчас', 'btn-glass', () => { visible = false; render(); })));
      }
      return;
    }

    if (s.game === 'rps') {
      if (s.phase === 'count') {
        body.append(h('div', { class: 'big-count', id: 'gCount', text: 'Су' }));
        if (isPlayer()) {
          const row = h('div', { class: 'rps-choices' });
          for (const v of ['rock', 'scissors', 'paper']) row.append(h('button', { class: 'rps-btn', type: 'button', 'data-v': v, onclick: () => pick(v) }, gsvg(v), h('span', { text: RPS[v] })));
          body.append(row);
          if (M.camOn) body.append(h('span', { class: 'gesture-note' }, svgIcon('hand'), 'Или покажите в камеру: кулак, ладонь, «викторию»'));
        } else body.append(h('p', { class: 'muted', text: 'Игроки выбирают…' }));
        body.append(h('div', { class: 'live-players' }));
      } else {
        const d = s.data, winners = d.winners || [];
        body.append(h('h2', { class: 'title', text: d.outcome === 'few' ? 'Мало ходов — переиграем?' : d.outcome === 'draw' ? 'Ничья' : resultTitle(winners, 'Ничья') }));
        const res = h('div', { class: 'rps-results' });
        Object.entries(d.picks || {}).forEach(([id, v], i) => {
          if (!RPS[v]) return;
          const c = h('div', { class: 'rps-res' + (winners.includes(id) ? ' win' : '') }, gsvg(v), h('b', { text: id === me.id ? 'Вы' : nameOf(id) }), h('small', { text: RPS[v] }));
          c.style.animationDelay = (i * 90) + 'ms'; res.append(c);
        });
        body.append(res);
        body.append(h('div', { class: 'live-players' }));
        if (isPlayer()) body.append(h('div', { class: 'row-gap' }, btn('Ещё раунд', 'btn-primary', () => req('start', { game: 'rps' })), btn('Другая игра', 'btn-glass', () => req('lobby'))));
        if (winners.length && !REDUCED.matches) FX.effect('confetti');
      }
      return;
    }

    if (s.game === 'ball') {
      if (s.phase === 'play') {
        body.classList.add('fill');
        const wrap = h('div', { class: 'ball-wrap' });
        const cvBox = h('div', { class: 'ball-cv' });
        const hud = h('div', { class: 'ball-hud' }, h('span', { class: 'pill glass', id: 'gTime', text: '0:40' }), h('span', { class: 'pill glass', id: 'gMine', text: '0' }));
        const count = h('div', { class: 'big-count', id: 'gCount' }); count.style.position = 'absolute'; count.style.inset = '0'; count.style.display = 'grid'; count.style.placeItems = 'center'; count.style.pointerEvents = 'none';
        cvBox.append(hud, count);
        const side = h('div', { class: 'ball-side' }, h('span', { class: 'field-label', text: 'Счёт' }), h('div', { id: 'gBoard', class: 'standings' }));
        wrap.append(cvBox, side); body.append(wrap);
        startBall(cvBox, isPlayer());
      } else {
        const d = s.data;
        body.append(h('h2', { class: 'title', text: resultTitle(d.winners || [], 'Никто не забросил') }));
        body.append(standings(Object.entries(d.pts || {}).sort((a, b) => b[1] - a[1]), v => String(v)));
        if (isPlayer()) body.append(h('div', { class: 'row-gap' }, btn('Ещё раз', 'btn-primary', () => req('start', { game: 'ball' })), btn('Другая игра', 'btn-glass', () => req('lobby'))));
        if ((d.winners || []).length && !REDUCED.matches) FX.effect('confetti');
      }
      return;
    }

    if (s.game === 'react') {
      if (s.phase === 'play') {
        body.classList.add('fill');
        const pad = h('div', { class: 'react-pad wait', id: 'gPad', role: 'button', tabindex: '0', 'aria-label': 'Нажмите, когда станет зелёным' }, h('h2', { id: 'gPadTitle', text: 'Ждите зелёного' }), h('p', { class: 'muted', id: 'gPadSub', text: isPlayer() ? 'Нажмите в любом месте или пробел' : 'Вы смотрите' }));
        pad.addEventListener('pointerdown', e => { e.preventDefault(); tap(); });
        body.append(pad);
      } else {
        const d = s.data, taps = Object.entries(d.taps || {});
        body.append(h('h2', { class: 'title', text: resultTitle(d.winners || [], 'Все поторопились') }));
        const sorted = taps.sort((a, b) => (a[1] < 0) - (b[1] < 0) || a[1] - b[1]);
        body.append(standings(sorted, v => v < 0 ? 'фальстарт' : v + ' мс'));
        if (isPlayer()) body.append(h('div', { class: 'row-gap' }, btn('Ещё раз', 'btn-primary', () => req('start', { game: 'react' })), btn('Другая игра', 'btn-glass', () => req('lobby'))));
      }
    }
  }

  // часть интерфейса, которая меняется без пересборки
  function updateLive() {
    if (!s || !s.open || !visible) return;
    const lp = $('#gameLayer .live-players');
    if (lp) {
      const ready = new Set(s.data.ready || []);
      const chips = chipsFor(s.players, id => s.scores[id] || 0);
      if (s.game === 'rps' && s.phase === 'count') chips.querySelectorAll('.chip').forEach((c, i) => { if (ready.has(s.players[i])) c.append(svgIcon('check')); });
      lp.replaceChildren(chips);
    }
    $$('#gameLayer .game-pick').forEach(b => { b.disabled = s.players.length < +b.dataset.min; });
    const now = hubNow();
    if (s.game === 'rps' && s.phase === 'count') {
      const rem = s.data.endsAt - now, c = $('#gCount');
      const word = rem > 2500 ? 'Су' : rem > 1200 ? 'Ли' : rem > 0 ? 'Фа!' : '…';
      if (c && c.textContent !== word) { c.textContent = word; c.style.animation = 'none'; void c.offsetWidth; c.style.animation = ''; }
      $$('#gameLayer .rps-btn').forEach(b => { b.classList.toggle('picked', b.dataset.v === myPick); b.disabled = rem < -500; });
    }
    if (s.game === 'ball' && s.phase === 'play') {
      const c = $('#gCount'), t = $('#gTime');
      const pre = s.data.startAt - now, left = s.data.endsAt - now;
      if (c) { const txt = pre > 0 ? String(Math.ceil(pre / 1000)) : left <= 0 ? 'Время!' : ''; if (c.textContent !== txt) c.textContent = txt; }
      if (t) t.textContent = fmtTime(Math.max(0, Math.min(40000, left)) / 1000);
      const mine = $('#gMine'); if (mine && ballGame) mine.textContent = 'Очки: ' + ballGame.pts;
      const board = $('#gBoard');
      if (board) board.replaceChildren(...Object.entries(s.data.pts || {}).sort((a, b) => b[1] - a[1]).map(([id, v]) => h('div', { class: 'score-row' + (id === me.id ? ' me' : '') }, avatar(nameOf(id)), h('span', { text: id === me.id ? 'Вы' : nameOf(id) }), h('b', { text: String(id === me.id && ballGame ? Math.max(v, ballGame.pts) : v) }))));
    }
    if (s.game === 'react' && s.phase === 'play') {
      const pad = $('#gPad'); if (!pad) return;
      const go = now >= s.data.goAt;
      pad.classList.toggle('wait', !go && myTap == null); pad.classList.toggle('go', go && myTap == null);
      const title = $('#gPadTitle'), sub = $('#gPadSub');
      if (myTap != null) { title.textContent = myTap < 0 ? 'Фальстарт!' : myTap + ' мс'; sub.textContent = 'Ждём остальных…'; }
      else { title.textContent = go ? 'Жми!' : 'Ждите зелёного'; }
    }
  }

  /* ---------- баскетбол ---------- */
  function startBall(box, playable) {
    stopBall();
    const cv = h('canvas'); box.prepend(cv);
    const g = cv.getContext('2d');
    const st = { pts: 0, ball: null, hoop: { x: 0, y: 0, w: 0, t: 0 }, W: 0, H: 0, r: 20, drag: null, raf: 0, last: performance.now(), flash: 0, net: 0, cv };
    ballGame = st;
    const resize = () => {
      const d = Math.min(2, devicePixelRatio || 1);
      st.W = cv.clientWidth; st.H = cv.clientHeight; cv.width = st.W * d; cv.height = st.H * d; g.setTransform(d, 0, 0, d, 0, 0);
      st.r = Math.max(16, Math.min(30, Math.min(st.W, st.H) * .05));
      st.hoop.y = st.H * .3; st.hoop.w = st.r * 3.3; if (!st.hoop.x) st.hoop.x = st.W / 2;
      if (!st.ball || !st.ball.fly) rest();
    };
    const rest = () => { st.ball = { x: st.W / 2, y: st.H - st.r * 2.4, vx: 0, vy: 0, fly: false, sc: 1, up: true, scored: false, t: 0, y0: 0 }; };
    st.ro = new ResizeObserver(resize); st.ro.observe(cv); resize();
    const active = () => { const n = hubNow(); return s && s.phase === 'play' && n >= s.data.startAt && n < s.data.endsAt; };
    const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() }; };
    cv.addEventListener('pointerdown', e => {
      if (!playable || !active() || st.ball.fly) return;
      const p = pos(e);
      if (Math.hypot(p.x - st.ball.x, p.y - st.ball.y) > st.r * 3.2) return;
      st.drag = { pts: [p] }; cv.setPointerCapture(e.pointerId); e.preventDefault();
    });
    cv.addEventListener('pointermove', e => {
      if (!st.drag) return;
      const p = pos(e); st.drag.pts.push(p); if (st.drag.pts.length > 12) st.drag.pts.shift();
      st.ball.x = Math.max(st.r, Math.min(st.W - st.r, p.x)); st.ball.y = Math.max(st.H * .6, Math.min(st.H - st.r, p.y));
    });
    const release = () => {
      if (!st.drag) return;
      const pts = st.drag.pts; st.drag = null;
      const a = pts.find(p => performance.now() - p.t < 120) || pts[0], b = pts[pts.length - 1];
      const dt = Math.max(16, b.t - a.t) / 1000, vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
      if (vy > -250) { rest(); return; }
      const B = st.ball;
      B.vy = Math.max(-st.H * 2.9, vy * 1.05); B.vx = Math.max(-st.W * 1.3, Math.min(st.W * 1.3, vx * .9));
      B.fly = true; B.up = true; B.scored = false; B.t = 0; B.y0 = B.y;
    };
    cv.addEventListener('pointerup', release); cv.addEventListener('pointercancel', release);

    const frame = now => {
      const dt = Math.min(.033, (now - st.last) / 1000); st.last = now;
      const { W, H, r } = st, hp = st.hoop, B = st.ball;
      // кольцо начинает двигаться после 5 попаданий
      hp.t += dt;
      if (st.pts >= 5) hp.x = W / 2 + Math.sin(hp.t * (0.8 + Math.min(st.pts - 5, 10) * .12)) * W * .26; else hp.x += (W / 2 - hp.x) * .1;
      if (B.fly) {
        const G = H * 2.5;
        const py = B.y;
        B.vy += G * dt; B.x += B.vx * dt; B.y += B.vy * dt; B.t += dt;
        if (B.up && B.vy > 0) B.up = false;
        B.sc = B.up ? Math.max(.62, 1 - .38 * Math.min(1, (B.y0 - B.y) / (H * .55))) : Math.max(.62, B.sc);
        const br = r * B.sc;
        if (!B.up) {
          for (const sx of [-1, 1]) {
            const rx = hp.x + sx * hp.w / 2, ry = hp.y, dx = B.x - rx, dy = B.y - ry, dist = Math.hypot(dx, dy), min = br + 3;
            if (dist < min && dist > 0) {
              const nx = dx / dist, ny = dy / dist, dot = B.vx * nx + B.vy * ny;
              if (dot < 0) { B.vx -= 1.6 * dot * nx; B.vy -= 1.6 * dot * ny; B.vx *= .75; B.vy *= .7; }
              B.x = rx + nx * min; B.y = ry + ny * min;
            }
          }
          if (!B.scored && py < hp.y && B.y >= hp.y && Math.abs(B.x - hp.x) < hp.w / 2 - br * .55) {
            B.scored = true; st.pts++; st.flash = 1; st.net = 1;
            if (s && s.phase === 'play') req('score', { n: st.pts });
          }
        }
        if (B.y > H + r * 3 || B.x < -r * 4 || B.x > W + r * 4 || B.t > 4) rest();
      }
      st.flash = Math.max(0, st.flash - dt * 1.5); st.net = Math.max(0, st.net - dt * 2.2);
      draw(g, st);
      st.raf = requestAnimationFrame(frame);
    };
    st.raf = requestAnimationFrame(frame);
  }
  function draw(g, st) {
    const { W, H, r } = st, hp = st.hoop, B = st.ball;
    g.clearRect(0, 0, W, H);
    // площадка
    const fl = g.createLinearGradient(0, H * .55, 0, H);
    fl.addColorStop(0, 'rgba(255,255,255,0)'); fl.addColorStop(1, 'rgba(255,255,255,.06)');
    g.fillStyle = fl; g.fillRect(0, H * .55, W, H * .45);
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1.5;
    g.beginPath(); g.ellipse(W / 2, H + H * .05, W * .35, H * .22, 0, Math.PI, 0); g.stroke();
    // щит
    const bw = hp.w * 1.9, bh = hp.w * 1.25, bx = hp.x - bw / 2, by = hp.y - bh + 4;
    g.fillStyle = 'rgba(255,255,255,.07)'; g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 2;
    g.beginPath(); g.roundRect ? g.roundRect(bx, by, bw, bh, 8) : g.rect(bx, by, bw, bh); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.strokeRect(hp.x - hp.w * .45, hp.y - hp.w * .62, hp.w * .9, hp.w * .55);
    // задняя дуга кольца
    g.strokeStyle = '#ff7a1a'; g.lineWidth = 3.5;
    g.beginPath(); g.ellipse(hp.x, hp.y, hp.w / 2, hp.w * .13, 0, Math.PI, 0); g.stroke();
    // сетка
    const sway = Math.sin(performance.now() / 60) * st.net * 4;
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.2;
    const nh = hp.w * .72 + st.net * 6;
    for (let i = 0; i <= 6; i++) {
      const t = i / 6, x1 = hp.x - hp.w / 2 + hp.w * t, x2 = hp.x - hp.w * .3 + hp.w * .6 * t + sway;
      g.beginPath(); g.moveTo(x1, hp.y); g.lineTo(x2, hp.y + nh); g.stroke();
    }
    for (let j = 1; j <= 3; j++) { const k = j / 3.4, w = hp.w * (1 - .4 * k); g.beginPath(); g.moveTo(hp.x - w / 2 + sway * k, hp.y + nh * k); g.lineTo(hp.x + w / 2 + sway * k, hp.y + nh * k); g.stroke(); }
    const ballFirst = B.fly && !B.up && B.y > hp.y - r;
    const drawBall = () => {
      const br = r * B.sc;
      if (!B.fly) { g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(B.x, B.y + br * 1.05, br * .9, br * .25, 0, 0, 7); g.fill(); }
      const gr = g.createRadialGradient(B.x - br * .35, B.y - br * .35, br * .1, B.x, B.y, br);
      gr.addColorStop(0, '#ffb36b'); gr.addColorStop(1, '#e8620c');
      g.fillStyle = gr; g.beginPath(); g.arc(B.x, B.y, br, 0, 7); g.fill();
      g.strokeStyle = 'rgba(40,15,0,.7)'; g.lineWidth = Math.max(1, br * .07);
      const rot = B.fly ? B.t * 6 * Math.sign(B.vx || 1) : 0;
      g.save(); g.translate(B.x, B.y); g.rotate(rot);
      g.beginPath(); g.moveTo(-br, 0); g.lineTo(br, 0); g.moveTo(0, -br); g.lineTo(0, br); g.stroke();
      g.beginPath(); g.arc(-br * 1.15, 0, br * .75, -.9, .9); g.stroke();
      g.beginPath(); g.arc(br * 1.15, 0, br * .75, Math.PI - .9, Math.PI + .9); g.stroke();
      g.restore();
    };
    if (!ballFirst) { frontRim(); drawBall(); } else { drawBall(); frontRim(); }
    function frontRim() { g.strokeStyle = '#ff8c32'; g.lineWidth = 4; g.beginPath(); g.ellipse(hp.x, hp.y, hp.w / 2, hp.w * .13, 0, 0, Math.PI); g.stroke(); }
    if (st.flash > 0) {
      g.globalAlpha = st.flash; g.fillStyle = '#30d158'; g.font = `800 ${Math.round(r * 2)}px -apple-system, Inter, sans-serif`; g.textAlign = 'center';
      g.fillText('+1', hp.x, hp.y - hp.w * 1.4 - (1 - st.flash) * 30); g.globalAlpha = 1;
    }
    if (!B.fly && s && s.phase === 'play' && hubNow() >= s.data.startAt && hubNow() < s.data.endsAt && st.pts === 0) {
      g.fillStyle = 'rgba(255,255,255,.5)'; g.font = '500 14px -apple-system, Inter, sans-serif'; g.textAlign = 'center';
      g.fillText('Смахните мяч вверх', W / 2, H - r * 4.4);
    }
  }
  function stopBall() {
    if (!ballGame) return;
    cancelAnimationFrame(ballGame.raf); try { ballGame.ro.disconnect(); } catch {}
    ballGame.cv.remove(); ballGame = null;
  }

  addEventListener('keydown', e => { if (e.code === 'Space' && s && s.game === 'react' && s.phase === 'play' && visible && !e.target.closest('input, textarea')) { e.preventDefault(); tap(); } });

  return {
    onMsg, onMembers, toggleRoom,
    show() { if (s && s.open) { visible = true; render(); } },
    reset() { closeLocal(); },
  };
})();
