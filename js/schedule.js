'use strict';
/* =====================================================================
   ЗАПЛАНИРОВАННЫЕ ВСТРЕЧИ. Сервера нет, поэтому всё о встрече лежит в
   самой ссылке (после #, эта часть не уходит на сервер): название,
   начало, конец, часовой пояс и, если есть пароль, соль и проверочная
   метка. Войти можно заранее; после окончания комната закрывается для
   всех, а по ссылке больше не пустит.
   ===================================================================== */
const TZ_RU = {
  'Asia/Almaty': 'Алматы', 'Asia/Qostanay': 'Костанай', 'Asia/Aqtobe': 'Актобе', 'Asia/Aqtau': 'Актау', 'Asia/Atyrau': 'Атырау', 'Asia/Oral': 'Уральск', 'Asia/Qyzylorda': 'Кызылорда',
  'Europe/Moscow': 'Москва', 'Europe/Kaliningrad': 'Калининград', 'Europe/Samara': 'Самара', 'Asia/Yekaterinburg': 'Екатеринбург', 'Asia/Omsk': 'Омск',
  'Asia/Novosibirsk': 'Новосибирск', 'Asia/Krasnoyarsk': 'Красноярск', 'Asia/Irkutsk': 'Иркутск', 'Asia/Vladivostok': 'Владивосток',
  'Asia/Tashkent': 'Ташкент', 'Asia/Bishkek': 'Бишкек', 'Asia/Dushanbe': 'Душанбе', 'Asia/Ashgabat': 'Ашхабад', 'Asia/Baku': 'Баку', 'Asia/Tbilisi': 'Тбилиси', 'Asia/Yerevan': 'Ереван',
  'Europe/Minsk': 'Минск', 'Europe/Kyiv': 'Киев', 'Europe/Kiev': 'Киев', 'Europe/Istanbul': 'Стамбул', 'Asia/Dubai': 'Дубай',
  'Europe/Berlin': 'Берлин', 'Europe/Paris': 'Париж', 'Europe/London': 'Лондон', 'Europe/Warsaw': 'Варшава', 'Europe/Prague': 'Прага',
  'America/New_York': 'Нью-Йорк', 'America/Los_Angeles': 'Лос-Анджелес', 'Asia/Bangkok': 'Бангкок', 'Asia/Shanghai': 'Шанхай', 'Asia/Tokyo': 'Токио', 'Asia/Seoul': 'Сеул',
};
const DUR_LABEL = { 30: '30 мин', 60: '1 ч', 90: '1,5 ч', 120: '2 ч', 180: '3 ч' };

const Sched = {
  myTz: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })(),
  dur: 60, pending: null, warned: {},

  /* ---------- данные ---------- */
  tzOk(z) { if (!z || typeof z !== 'string' || z.length > 64) return false; try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; } catch { return false; } },
  clean(x) {
    if (!x || typeof x !== 'object') return null;
    const t = Math.floor(+x.t), e = Math.floor(+x.e);
    if (!Number.isFinite(t) || !Number.isFinite(e) || t < 1.6e9 || t > 4.1e9 || e <= t || e - t > 12 * 3600) return null;
    const n = x.n ? String(x.n).replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, '').trim().slice(0, 60) : '';
    return { t, e, n, z: this.tzOk(x.z) ? x.z : null };
  },
  fromMeta(m) { return m && m.t ? this.clean(m) : null; },

  /* ---------- время и пояса ---------- */
  offsetMs(tz, ts) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ts)).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000;
  },
  zonedToUtc(date, time, tz) {
    const [y, m, d] = date.split('-').map(Number), [hh, mm] = time.split(':').map(Number);
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    let ts = guess - this.offsetMs(tz, guess);
    return guess - this.offsetMs(tz, ts);
  },
  partsIn(tz, ts) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ts)).map(x => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${String(+p.hour % 24).padStart(2, '0')}:${p.minute}` };
  },
  gmt(tz, ts = Date.now()) {
    const off = Math.round(this.offsetMs(tz, ts) / 60000), a = Math.abs(off);
    return 'GMT' + (off >= 0 ? '+' : '−') + Math.floor(a / 60) + (a % 60 ? ':' + String(a % 60).padStart(2, '0') : '');
  },
  city(tz) { return TZ_RU[tz] || tz.split('/').pop().replace(/_/g, ' '); },
  tzLabel(tz, ts) { return `${this.city(tz)} (${this.gmt(tz, ts)})`; },
  fmtDay(tz, ts) { return new Intl.DateTimeFormat('ru-RU', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'long' }).format(new Date(ts)); },
  fmtTime(tz, ts) { return new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ts)); },
  when(sc, tz) {
    tz = tz || sc.z || this.myTz;
    const a = sc.t * 1000, b = sc.e * 1000, sameDay = this.partsIn(tz, a).date === this.partsIn(tz, b).date;
    return `${this.fmtDay(tz, a)}, ${this.fmtTime(tz, a)}–${sameDay ? '' : this.fmtDay(tz, b) + ', '}${this.fmtTime(tz, b)}`;
  },
  localLine(sc) {
    if (!sc.z || sc.z === this.myTz || this.offsetMs(sc.z, sc.t * 1000) === this.offsetMs(this.myTz, sc.t * 1000)) return '';
    return `У вас: ${this.when(sc, this.myTz)} · ${this.tzLabel(this.myTz, sc.t * 1000)}`;
  },
  span(ms) {
    const m = Math.ceil(ms / 60000);
    if (ms < 60000) return 'меньше минуты';
    const d = Math.floor(m / 1440), hh = Math.floor(m % 1440 / 60), mm = m % 60;
    if (d) return `${d} дн${hh ? ' ' + hh + ' ч' : ''}`;
    if (hh) return `${hh} ч${mm ? ' ' + mm + ' мин' : ''}`;
    return `${mm} мин`;
  },
  clock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000)), hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60;
    return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0');
  },
  status(sc, now = Date.now()) {
    if (now < sc.t * 1000) return { k: 'before', ms: sc.t * 1000 - now, text: 'Начнётся через ' + this.span(sc.t * 1000 - now) };
    if (now < sc.e * 1000) return { k: 'live', ms: sc.e * 1000 - now, text: 'Идёт сейчас · осталось ' + this.span(sc.e * 1000 - now) };
    return { k: 'over', ms: 0, text: 'Встреча завершилась' };
  },

  /* ---------- главная: приглашение на встречу ---------- */
  invite: null,
  renderInvite(meta) {
    const sc = this.fromMeta(meta);
    this.invite = sc;
    $('#schedInfo').classList.toggle('hidden', !sc);
    $('#inviteLabel').textContent = sc ? 'Вас пригласили на встречу' : 'Вас пригласили в комнату';
    $('#inviteCode').classList.toggle('small', !!sc);
    if (!sc) { $('#joinInviteBtn').disabled = false; return; }
    $('#siTitle').textContent = sc.n || 'Встреча';
    $('#siWhen').textContent = this.when(sc) + ' · ' + this.tzLabel(sc.z || this.myTz, sc.t * 1000);
    const loc = this.localLine(sc); $('#siLocal').textContent = loc; $('#siLocal').classList.toggle('hidden', !loc);
    this.inviteTick();
  },
  inviteTick() {
    const sc = this.invite; if (!sc || $('#home').classList.contains('hidden')) return;
    const st = this.status(sc);
    const chip = $('#siStatus'); chip.dataset.k = st.k; chip.lastChild.textContent = st.text;
    const btn = $('#joinInviteBtn'); btn.disabled = st.k === 'over';
    btn.firstChild.textContent = st.k === 'over' ? 'Встреча завершилась' : st.k === 'before' ? 'Войти заранее' : 'Присоединиться';
  },

  /* ---------- звонок: отсчёт в верхней панели ---------- */
  callTick() {
    const pill = $('#timePill');
    const sc = S.inCall && S.room && S.room.sched;
    if (!sc) { pill.classList.add('hidden'); return; }
    const st = this.status(sc);
    pill.classList.remove('hidden');
    pill.dataset.k = st.k;
    pill.classList.toggle('warn', st.k === 'live' && st.ms <= 5 * 60000);
    $('#timeText').textContent = st.k === 'before' ? 'До начала ' + this.clock(st.ms) : st.k === 'live' ? 'До конца ' + this.clock(st.ms) : 'Время вышло';
    pill.title = (sc.n ? sc.n + ' · ' : '') + this.when(sc) + ' · ' + this.tzLabel(sc.z || this.myTz, sc.t * 1000);
    const key = sc.t + ':' + sc.e;
    if (st.k === 'live' && st.ms <= 5 * 60000 && !this.warned[key + '5']) { this.warned[key + '5'] = 1; toast('До конца встречи 5 минут', { icon: 'clock', ms: 4000 }); }
    if (st.k === 'live' && st.ms <= 60000 && !this.warned[key + '1']) { this.warned[key + '1'] = 1; toast('Встреча закончится через минуту', { icon: 'clock', ms: 4000 }); }
    if (st.k === 'live' && !this.warned[key + 's'] && st.ms < (sc.e - sc.t) * 1000 && Date.now() - sc.t * 1000 < 1500) { this.warned[key + 's'] = 1; toast('Встреча началась', { icon: 'clock' }); }
  },
  previewTick() {
    if ($('#preview').classList.contains('hidden') || !S.meta || !S.meta.t) return;
    const sc = this.fromMeta(S.meta); if (!sc) return;
    $('#pvSub').textContent = this.status(sc).text + ' · ' + this.when(sc, this.myTz);
  },

  /* ---------- окно «Запланировать» ---------- */
  fillTz(sel, current) {
    let zones = [];
    try { zones = Intl.supportedValuesOf('timeZone'); } catch {}
    if (!zones.length) zones = Object.keys(TZ_RU);
    const set = new Set(zones); set.add(this.myTz); if (current) set.add(current);
    const now = Date.now();
    const list = [...set].filter(z => this.tzOk(z)).map(z => ({ z, off: this.offsetMs(z, now), ru: !!TZ_RU[z] }));
    list.sort((a, b) => a.off - b.off || (b.ru - a.ru) || this.city(a.z).localeCompare(this.city(b.z), 'ru'));
    sel.replaceChildren();
    const mine = h('optgroup', { label: 'Ваш часовой пояс' }, h('option', { value: this.myTz, text: `${this.gmt(this.myTz)} · ${this.city(this.myTz)}` }));
    const all = h('optgroup', { label: 'Все часовые пояса' });
    for (const x of list) all.append(h('option', { value: x.z, text: `${this.gmt(x.z)} · ${this.city(x.z)}${TZ_RU[x.z] ? '' : ''}` }));
    sel.append(mine, all);
    sel.value = current || this.myTz;
  },
  open() {
    const tz = ls.get('schedTz', '') && this.tzOk(ls.get('schedTz', '')) ? ls.get('schedTz', '') : this.myTz;
    this.fillTz($('#sTz'), tz);
    const now = Date.now(), next = Math.ceil((now + 5 * 60000) / (30 * 60000)) * 30 * 60000;
    const p = this.partsIn(tz, next);
    $('#sDate').value = p.date; $('#sTime').value = p.time; $('#sDate').min = this.partsIn(tz, now).date;
    $('#sTitle').value = ''; $('#sPass').value = ''; $('#sErr').classList.add('hidden');
    this.setDur(ls.get('schedDur', 60));
    $('#schedForm').classList.remove('hidden'); $('#schedDone').classList.add('hidden');
    $('#schedModal').classList.remove('hidden');
    this.formTick();
    setTimeout(() => $('#sTitle').focus(), 80);
  },
  setDur(m) {
    this.dur = DUR_LABEL[m] ? m : 60;
    $$('#sDur button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.m === this.dur)));
    this.formTick();
  },
  readForm() {
    const tz = $('#sTz').value || this.myTz, d = $('#sDate').value, t = $('#sTime').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}/.test(t)) return null;
    const start = this.zonedToUtc(d, t.slice(0, 5), tz);
    return { tz, start, end: start + this.dur * 60000 };
  },
  formTick() {
    if ($('#schedModal').classList.contains('hidden') || $('#schedForm').classList.contains('hidden')) return;
    const f = this.readForm(), out = $('#sLocal');
    if (!f) { out.textContent = ''; return; }
    const sc = { t: Math.floor(f.start / 1000), e: Math.floor(f.end / 1000), z: f.tz };
    const parts = [];
    if (f.end <= Date.now()) parts.push('Это время уже прошло');
    else parts.push(this.status(sc).text);
    parts.push(`${this.fmtTime(f.tz, f.start)}–${this.fmtTime(f.tz, f.end)} · ${this.tzLabel(f.tz, f.start)}`);
    const loc = this.localLine(sc); if (loc) parts.push(loc);
    out.replaceChildren(...parts.map((x, i) => h('span', { class: i === 0 ? 'sl-main' : '', text: x })));
  },
  async submit(e) {
    e.preventDefault();
    const f = this.readForm(), err = $('#sErr');
    const fail = msg => { err.textContent = msg; err.classList.remove('hidden'); };
    if (!f) return fail('Укажите дату и время');
    if (f.start < Date.now() - 5 * 60000) return fail('Это время уже прошло — выберите будущее');
    if (f.start > Date.now() + 366 * 86400000) return fail('Не дальше чем через год');
    const btn = $('#schedForm button[type=submit]'); btn.disabled = true;
    try {
      const code = genCode();
      const sc = this.clean({ n: $('#sTitle').value, t: Math.floor(f.start / 1000), e: Math.floor(f.end / 1000), z: f.tz });
      const meta = { ...sc };
      let key = null, salt = null;
      const pw = $('#sPass').value;
      if (pw) { salt = toB64(crypto.getRandomValues(new Uint8Array(16))); key = await Crypt.deriveKey(pw, salt); meta.s = salt; meta.v = await passVerifier(key, code); }
      ls.set('schedTz', f.tz); ls.set('schedDur', this.dur);
      const hash = metaHash(code, sc, meta);
      this.pending = { code, meta, key, salt, hash, link: location.origin + location.pathname + '#' + hash };
      this.showDone();
    } finally { btn.disabled = false; }
  },
  showDone() {
    const p = this.pending, sc = this.fromMeta(p.meta);
    $('#dTitle').textContent = sc.n || 'Встреча';
    $('#dWhen').textContent = this.when(sc) + ' · ' + this.tzLabel(sc.z || this.myTz, sc.t * 1000);
    $('#dLink').value = p.link;
    $('#dPass').classList.toggle('hidden', !p.meta.s);
    $('#dCopy').lastChild.textContent = 'Только скопировать';
    $('#schedForm').classList.add('hidden'); $('#schedDone').classList.remove('hidden');
    this.doneTick();
  },
  doneTick() {
    if (!this.pending || $('#schedModal').classList.contains('hidden') || $('#schedDone').classList.contains('hidden')) return;
    const st = this.status(this.fromMeta(this.pending.meta));
    const chip = $('#dStatus'); chip.dataset.k = st.k; chip.lastChild.textContent = st.text;
  },
  async copyOnly() {
    await copyText(this.pending.link, 'Ссылка на встречу скопирована');
    $('#dCopy').lastChild.textContent = 'Скопировано';
  },
  async copyAndEnter() {
    const p = this.pending; if (!p) return;
    await copyText(p.link, 'Ссылка скопирована — заходим');
    $('#schedModal').classList.add('hidden');
    history.replaceState(null, '', '#' + p.hash);
    S.preset = p.key ? { code: p.code, key: p.key, salt: p.salt } : null;
    goPreview('join', p.code);
  },

  init() {
    $('#schedBtn').onclick = () => this.open();
    $('#schedForm').onsubmit = e => this.submit(e);
    $$('#sDur button').forEach(b => b.onclick = () => this.setDur(+b.dataset.m));
    ['#sDate', '#sTime', '#sTz'].forEach(s => $(s).addEventListener('input', () => this.formTick()));
    $('#sTz').addEventListener('change', () => this.formTick());
    $('#dEnter').onclick = () => this.copyAndEnter();
    $('#dCopy').onclick = () => this.copyOnly();
    $('#dBack').onclick = () => { $('#schedForm').classList.remove('hidden'); $('#schedDone').classList.add('hidden'); this.formTick(); };
    $('#dLink').addEventListener('focus', e => e.target.select());
    setInterval(() => { this.inviteTick(); this.callTick(); this.previewTick(); this.formTick(); this.doneTick(); }, 1000);
  },
};
window.addEventListener('DOMContentLoaded', () => Sched.init());
