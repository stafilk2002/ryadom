'use strict';
/* =====================================================================
   ИГРОВАЯ КОМНАТА. Открыл один — у всех появляется экран ожидания.
   Игра: Сулифа (камень, ножницы, бумага).
   Состоянием управляет «ведущий» (кто открыл комнату; если он уходит —
   следующий игрок). Ходы до вскрытия знает только ведущий.
   ===================================================================== */
const GAME_SVG = {
  rock: '<path d="M4.5 15.2l1.6-6.1L11.2 5.6l5.6 1.3 2.7 5.1-1.6 5.3-6.1 2.1-5.3-1.6z"/><path d="M11.2 5.6l1.2 5.6 7.1.8M12.4 11.2l-6.3-2.1M12.4 11.2l-1.6 8"/>',
  paper: '<rect x="6" y="3.5" width="12" height="17" rx="2.2"/><path d="M9 8h6M9 11h6M9 14h4"/>',
  scissors: '<circle cx="7" cy="17.2" r="2.7"/><circle cx="17" cy="17.2" r="2.7"/><path d="M8.9 15.3L16.2 3.8M15.1 15.3L7.8 3.8"/>',
};
const gsvg = name => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'game-svg'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = GAME_SVG[name]; return s; };
const RPS = { rock: 'Камень', scissors: 'Ножницы', paper: 'Бумага' };
const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };

const Games = (() => {
  let s = null, A = null, secret = {};
  let visible = false, renderedKey = '', myPick = null;
  let leaderTimer = 0, ticker = 0, publishT = 0;

  const isLeader = () => !!(s && s.open && s.leader === me.id);
  const isPlayer = (id = me.id) => !!(s && s.players.includes(id));
  const sendG = (d, to) => send(to ? { t: 'g', d, to } : { t: 'g', d });
  const req = (a, extra) => { if (s && s.open) sendG({ k: 'req', a, ...(extra || {}) }, s.leader); };
  const clone = o => JSON.parse(JSON.stringify(o));
  const publish = () => { if (A) { A.v = (A.v || 0) + 1; sendG({ k: 'state', s: A }); } };
  const publishSoon = () => { if (!publishT) publishT = setTimeout(() => { publishT = 0; publish(); }, 350); };

  function sanitize(x) {
    if (!x || typeof x !== 'object') return null;
    const ids = a => Array.isArray(a) ? a.filter(v => typeof v === 'string').slice(0, 8) : [];
    return {
      open: !!x.open, leader: String(x.leader || ''), players: ids(x.players),
      phase: ['lobby', 'count', 'result'].includes(x.phase) ? x.phase : 'lobby',
      scores: x.scores && typeof x.scores === 'object' ? x.scores : {}, data: x.data && typeof x.data === 'object' ? x.data : {}, v: +x.v || 0,
    };
  }

  function onMsg(from, d) {
    if (!d || typeof d !== 'object') return;
    if (d.k === 'state') {
      const ns = sanitize(d.s); if (!ns) return;
      if (!(ns.leader === from || (s && s.open && s.leader === from))) return;
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
    if (prev && prev.phase !== s.phase) myPick = null;
    render();
  }

  function closeLocal(msg) {
    s = null; A = null; secret = {}; visible = false; renderedKey = '';
    clearTimeout(leaderTimer); clearInterval(ticker); ticker = 0;
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
        if (from === A.leader) A.leader = A.players[0];
        if (A.players.length < 2 && A.phase !== 'lobby') { clearTimeout(leaderTimer); A.phase = 'lobby'; A.data = {}; }
        publish(); break;
      case 'close': if (from === A.leader) { A.open = false; publish(); } break;
      case 'start':
        if (player && A.phase !== 'count' && A.players.length >= 2) {
          clearTimeout(leaderTimer); secret = {};
          A.phase = 'count'; A.data = { endsAt: hubNow() + 3800, ready: [] };
          leaderTimer = setTimeout(resolve, Math.max(0, A.data.endsAt + 700 - hubNow()));
          publish();
        }
        break;
      case 'pick':
        if (player && A.phase === 'count' && RPS[d.v] && hubNow() < A.data.endsAt + 800) {
          secret[from] = d.v; A.data.ready = Object.keys(secret); publishSoon();
        }
        break;
    }
  }
  function resolve() {
    if (!A || A.phase !== 'count') return;
    const picks = {}; for (const [id, v] of Object.entries(secret)) if (A.players.includes(id)) picks[id] = v;
    const kinds = new Set(Object.values(picks));
    let winners = [], outcome = 'draw';
    if (Object.keys(picks).length < 2) outcome = 'few';
    else if (kinds.size === 2) { const [a, b] = [...kinds]; const w = BEATS[a] === b ? a : b; winners = Object.keys(picks).filter(id => picks[id] === w); outcome = 'win'; }
    for (const id of winners) A.scores[id] = (A.scores[id] || 0) + 1;
    A.phase = 'result'; A.data = { picks, winners, outcome }; secret = {};
    publish();
  }

  function onMembers() {
    if (!s || !s.open) return;
    if (!memberOf(s.leader)) {
      const next = s.players.find(id => memberOf(id));
      if (!next) { if (S.members[0] && S.members[0].id === me.id) { A = clone(s); A.leader = me.id; A.open = false; publish(); } else if (!S.members.length) closeLocal(); return; }
      if (next === me.id) {
        A = clone(s); A.leader = me.id; A.players = A.players.filter(id => memberOf(id));
        if (A.phase === 'count') { A.phase = 'lobby'; A.data = {}; }
        publish();
      }
      return;
    }
    if (isLeader() && A) {
      const alive = A.players.filter(id => memberOf(id));
      if (alive.length !== A.players.length) { A.players = alive; publish(); } else publishSoon();
    }
  }

  function toggleRoom() {
    if (!S.inCall) return;
    if (!s || !s.open) {
      A = { open: true, leader: me.id, players: [me.id], phase: 'lobby', scores: { [me.id]: 0 }, data: {}, v: 0 };
      publish(); return;
    }
    visible = !visible; render();
  }
  function pick(v) {
    if (!isPlayer() || myPick === v) return;
    myPick = v; req('pick', { v }); updateLive();
  }

  /* ---------- отрисовка ---------- */
  const btn = (text, cls, fn) => h('button', { class: 'btn ' + cls, type: 'button', onclick: fn }, h('span', { text }));
  const who = id => id === me.id ? 'Вы' : nameOf(id);

  function render() {
    const layer = $('#gameLayer'), on = !!(s && s.open);
    $('#gamePill').classList.toggle('hidden', !on || visible);
    $('#gameBtn').classList.toggle('active', on);
    if (on) $('#gamePillText').textContent = 'Сулифа · ' + s.players.length;
    if (!on || !visible) { layer.classList.add('hidden'); if (L.game) { L.game = false; layout(); } clearInterval(ticker); ticker = 0; return; }
    layer.classList.remove('hidden');
    if (!L.game) { L.game = true; layout(); }
    const key = [s.phase, s.data.endsAt || '', isPlayer(), s.leader === me.id, s.players.length >= 2].join('|');
    if (key !== renderedKey || !layer.firstChild) { renderedKey = key; build(layer); }
    updateLive();
    if (s.phase === 'count' && !ticker) ticker = setInterval(updateLive, 100);
    if (s.phase !== 'count') { clearInterval(ticker); ticker = 0; }
  }

  function build(layer) {
    const head = h('div', { class: 'game-head' }, svgIcon('game'), h('h3', { text: 'Сулифа' }), h('span', { class: 'game-sub', text: 'камень · ножницы · бумага' }));
    if (isPlayer()) head.append(h('button', { class: 'icon-btn', type: 'button', title: 'Выйти из игры', 'aria-label': 'Выйти из игры', onclick: () => req('leave') }, svgIcon('leave')));
    head.append(h('button', { class: 'icon-btn', type: 'button', title: 'Свернуть', 'aria-label': 'Свернуть игровую комнату', onclick: () => { visible = false; render(); } }, svgIcon('close')));
    const body = h('div', { class: 'game-body' });
    layer.replaceChildren(h('div', { class: 'game-card glass-strong' }, head, body));

    if (s.phase === 'lobby') {
      const enough = s.players.length >= 2;
      body.append(h('div', { class: 'rps-hero' }, gsvg('rock'), gsvg('scissors'), gsvg('paper')));
      body.append(h('h2', { class: 'title', text: enough ? 'Все готовы?' : 'Ждём игроков' }));
      body.append(h('div', { class: 'live-players' }));
      if (isPlayer()) {
        if (enough) body.append(btn('Начать раунд', 'btn-primary btn-wide', () => req('start')));
        else body.append(h('div', { class: 'waiting' }, 'Пусть кто-нибудь нажмёт «Присоединиться»', h('i', { text: '.' }), h('i', { text: '.' }), h('i', { text: '.' })));
        if (s.leader === me.id) body.append(h('button', { class: 'link-btn subtle', type: 'button', onclick: () => req('close') }, h('span', { text: 'Закрыть игровую комнату для всех' })));
      } else {
        body.append(h('p', { class: 'muted', text: `${nameOf(s.leader)} зовёт сыграть. Звонок продолжается.` }));
        body.append(h('div', { class: 'row-gap' }, btn('Присоединиться', 'btn-primary', () => req('join')), btn('Не сейчас', 'btn-glass', () => { visible = false; render(); })));
      }
      return;
    }
    if (s.phase === 'count') {
      body.append(h('div', { class: 'big-count', id: 'gCount', text: 'Су' }));
      if (isPlayer()) {
        const row = h('div', { class: 'rps-choices' });
        for (const v of ['rock', 'scissors', 'paper']) row.append(h('button', { class: 'rps-btn', type: 'button', 'data-v': v, onclick: () => pick(v) }, gsvg(v), h('span', { text: RPS[v] })));
        body.append(row);
      } else body.append(h('p', { class: 'muted', text: 'Игроки выбирают…' }));
      body.append(h('div', { class: 'live-players' }));
      return;
    }
    const d = s.data, winners = d.winners || [];
    const title = d.outcome === 'few' ? 'Мало ходов — переиграем?' : d.outcome === 'draw' ? 'Ничья'
      : winners.length === 1 && winners[0] === me.id ? 'Вы победили!' : 'Победа: ' + winners.map(id => id === me.id ? 'вы' : nameOf(id)).join(', ');
    body.append(h('h2', { class: 'title', text: title }));
    const res = h('div', { class: 'rps-results' });
    Object.entries(d.picks || {}).forEach(([id, v], i) => {
      if (!RPS[v]) return;
      const c = h('div', { class: 'rps-res' + (winners.includes(id) ? ' win' : '') }, gsvg(v), h('b', { text: who(id) }), h('small', { text: RPS[v] }));
      c.style.animationDelay = (i * 90) + 'ms'; res.append(c);
    });
    body.append(res, h('div', { class: 'live-players' }));
    if (isPlayer()) body.append(btn('Ещё раунд', 'btn-primary btn-wide', () => req('start')));
    if (winners.includes(me.id)) FX.confetti();
  }

  function updateLive() {
    if (!s || !s.open || !visible) return;
    const lp = $('#gameLayer .live-players');
    if (lp) {
      const ready = new Set(s.data.ready || []);
      lp.replaceChildren(h('div', { class: 'chips' }, s.players.map(id => h('span', { class: 'chip' }, avatar(nameOf(id)), who(id), h('b', { text: String(s.scores[id] || 0) }), s.phase === 'count' && ready.has(id) ? svgIcon('check') : null))));
    }
    if (s.phase === 'count') {
      const rem = s.data.endsAt - hubNow(), c = $('#gCount');
      const word = rem > 2500 ? 'Су' : rem > 1200 ? 'Ли' : rem > 0 ? 'Фа!' : '…';
      if (c && c.textContent !== word) { c.textContent = word; c.style.animation = 'none'; void c.offsetWidth; c.style.animation = ''; }
      $$('#gameLayer .rps-btn').forEach(b => { b.classList.toggle('picked', b.dataset.v === myPick); b.disabled = rem < -500; });
    }
  }

  return { onMsg, onMembers, toggleRoom, show() { if (s && s.open) { visible = true; render(); } }, reset() { closeLocal(); } };
})();
