'use strict';
/* Тонкие линейные иконки, единый стиль: 24×24, обводка 1.6, скруглённые концы.
   Строки статичные — в innerHTML попадают только они, никаких пользовательских данных. */
window.ICONS = {
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
  micOff: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/><path class="slash" d="M4 3.5l16 17"/>',
  cam: '<rect x="2.5" y="6.5" width="13" height="11" rx="2.5"/><path d="M15.5 10.5l6-3.5v10l-6-3.5z"/>',
  camOff: '<rect x="2.5" y="6.5" width="13" height="11" rx="2.5"/><path d="M15.5 10.5l6-3.5v10l-6-3.5z"/><path class="slash" d="M3.5 3.5l16 17"/>',
  screen: '<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20h7M12 16.5V20M12 13V7.8M9.6 10.2L12 7.8l2.4 2.4"/>',
  screenOff: '<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20h7M12 16.5V20M9.5 8l5 5M14.5 8l-5 5"/>',
  end: '<path d="M3.3 13.4c4.9-4.4 12.5-4.4 17.4 0 .6.6.6 1.5.1 2.1l-1.3 1.4c-.5.5-1.3.6-1.9.2l-2-1.3c-.5-.3-.7-.9-.6-1.5l.3-1.4a9.6 9.6 0 0 0-6.6 0l.3 1.4c.1.6-.1 1.2-.6 1.5l-2 1.3c-.6.4-1.4.3-1.9-.2l-1.3-1.4c-.5-.6-.5-1.5.1-2.1z"/>',
  more: '<circle class="dotf" cx="5.5" cy="12" r="1.3"/><circle class="dotf" cx="12" cy="12" r="1.3"/><circle class="dotf" cx="18.5" cy="12" r="1.3"/>',
  people: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.3c1.8.6 3 2.2 3.5 4.7"/>',
  chat: '<path d="M20 11.5a8 8 0 0 1-11.7 7.1L4 19.8l1.1-4A8 8 0 1 1 20 11.5z"/>',
  game: '<path d="M7.2 7.5h9.6a4.2 4.2 0 0 1 4.2 4.6l-.4 4a2.7 2.7 0 0 1-4.6 1.6L14 15.5h-4l-2 2.2a2.7 2.7 0 0 1-4.6-1.6l-.4-4a4.2 4.2 0 0 1 4.2-4.6z"/><path d="M7.5 10.5v3.2M5.9 12.1h3.2"/><circle class="dotf" cx="15.6" cy="11" r=".9"/><circle class="dotf" cx="17.4" cy="13.2" r=".9"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.3 14.3a4.6 4.6 0 0 0 7.4 0M9 9.3v.8M15 9.3v.8"/>',
  record: '<circle cx="12" cy="12" r="8.5"/><circle class="dotf" cx="12" cy="12" r="3.8"/>',
  stop: '<circle cx="12" cy="12" r="8.5"/><rect class="dotf" x="9" y="9" width="6" height="6" rx="1.2"/>',
  shot: '<path d="M4 8.5a2 2 0 0 1 2-2h1.8l1.4-2h5.6l1.4 2H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.6" r="3.5"/>',
  pip: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.8"/><rect x="12.5" y="11.5" width="6.5" height="5.2" rx="1.2"/>',
  side: '<rect x="2.5" y="6" width="8.5" height="12" rx="2"/><rect x="13" y="6" width="8.5" height="12" rx="2"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="1.6 2.4"/><path d="M9 7.5L4 17h5zM15 7.5l5 9.5h-5z"/>',
  settings: '<path d="M4 7h9M18 7h2M4 17h3M11 17h9"/><circle cx="15.5" cy="7" r="2.3"/><circle cx="9" cy="17" r="2.3"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.6"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2.6"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.3-1.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
  link: '<path d="M10.2 13.8a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1M13.8 10.2a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  speaker: '<path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  flip: '<path d="M4 8.5a2 2 0 0 1 2-2h1.8l1.4-2h5.6l1.4 2H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M9 12.6a3 3 0 0 1 5.3-1.9M15 12.6a3 3 0 0 1-5.3 1.9M14.6 9v1.8h-1.8M9.4 16.2v-1.8h1.8"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M9 12l2.2 2.2L15.3 10"/>',
  userX: '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c.7-3.6 3.3-5.5 6.5-5.5 1.3 0 2.5.3 3.5.9M16.2 15.2l4 4M20.2 15.2l-4 4"/>',
  hand: '<path d="M8 12.5V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V5.5a1.5 1.5 0 0 1 3 0V12.5M17 11a1.5 1.5 0 0 1 3 0v3a7 7 0 0 1-7 7h-.8a6.5 6.5 0 0 1-5.3-2.8l-2.6-3.9a1.5 1.5 0 0 1 2.4-1.8L8 14.8"/>',
  back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  crown: '<path d="M4 17.5L3 8.5l4.8 3.7L12 6l4.2 6.2L21 8.5l-1 9z"/>',
  send: '<path d="M5 12h7M4.3 4.6l15.5 7a.5.5 0 0 1 0 .9l-15.5 7a.5.5 0 0 1-.7-.6L6 12 3.6 5.2a.5.5 0 0 1 .7-.6z"/>',
  leave: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 8l-4 4 4 4M6 12h10"/>',
  pin: '<path d="M9 4h6l-1 5 3 3v1.5H7V12l3-3zM12 13.5V20"/>',
  volume: '<path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  trophy: '<path d="M8 4.5h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13.5V17M8.5 20h7M9.5 17h5v3h-5z"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  dots: '<circle class="dotf" cx="6" cy="12" r="1.3"/><circle class="dotf" cx="12" cy="12" r="1.3"/><circle class="dotf" cx="18" cy="12" r="1.3"/>',
};
window.svgIcon = function (name, cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'ico' + (cls ? ' ' + cls : ''));
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = window.ICONS[name] || '';
  return s;
};
window.paintIcons = function (root) {
  (root || document).querySelectorAll('[data-icon]').forEach(el => {
    const n = el.dataset.icon;
    if (el._icon === n) return;
    el._icon = n; el.replaceChildren(window.svgIcon(n));
  });
};
