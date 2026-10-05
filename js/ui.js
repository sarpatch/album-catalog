// Pienet käyttöliittymäapurit: DOM-rakentaja, ikonit, ilmoitukset ja dialogit.

/** Luo elementin. Käyttäjän tekstit menevät aina textContentina (ei XSS-riskiä). */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) el.style.setProperty(p.startsWith('--') ? p : p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`), val);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const PATHS = {
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  camera: 'M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  palette: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1 0-.8.7-1.4 1.5-1.4H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8zM7.5 11.5h.01M10.5 7.5h.01M15.5 7.5h.01',
  cloud: 'M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z',
  cloudOff: 'M3 3l18 18M8.5 8.4A5 5 0 0 0 7 18h10M19.7 16.4A4 4 0 0 0 19 10a6 6 0 0 0-8.3-5.5',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  close: 'M6 6l12 12M18 6L6 18',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  sync: 'M20 11a8 8 0 0 0-14.7-4.3L4 8M4 4v4h4M4 13a8 8 0 0 0 14.7 4.3L20 16M20 20v-4h-4',
  check: 'M5 12l5 5 9-10',
  alert: 'M12 8v5M12 16.5h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  rotate: 'M20 12a8 8 0 1 1-2.3-5.7L20 8.6M20 3v5.6h-5.6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  back: 'M15 5l-7 7 7 7',
  disc: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  login: 'M15 4h4v16h-4M10 8l4 4-4 4M14 12H3',
  filter: 'M3 5h18l-7 8v6l-4-2v-4z',
  columns: 'M4 4h16v16H4zM9.5 4v16M14.5 4v16',
  table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14',
  fields: 'M4 6h10M4 12h16M4 18h7M18 4v4M16 6h4',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  refresh: 'M20 11a8 8 0 0 0-14.7-4.3L4 8M4 4v4h4M4 13a8 8 0 0 0 14.7 4.3L20 16M20 20v-4h-4',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  sortAsc: 'M4 6h9M4 12h6M4 18h3M17 4v16M14 17l3 3 3-3',
  sortDesc: 'M4 6h3M4 12h6M4 18h9M17 4v16M14 17l3 3 3-3',
};

export function icon(name, size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', PATHS[name] || '');
  svg.append(p);
  return svg;
}

// ── Ilmoitukset ─────────────────────────────────────────────────────────────
export function toast(message, { action, onAction, timeout = 4500, kind = '' } = {}) {
  const host = document.getElementById('toasts');
  const el = h('div', { class: `toast ${kind}`, role: 'status' },
    h('span', {}, message),
    action && h('button', { class: 'btn btn-text', onclick: () => { onAction?.(); close(); } }, action));
  // Enintään kaksi ilmoitusta kerrallaan; vanhat ilman toimintoa poistuvat
  [...host.children].filter((t) => !t.querySelector('button')).slice(0, -1).forEach((t) => t.remove());
  host.append(el);
  const timer = setTimeout(close, timeout);
  function close() { clearTimeout(timer); el.classList.add('out'); setTimeout(() => el.remove(), 250); }
  return close;
}

// ── Dialogit ────────────────────────────────────────────────────────────────
// Selaimen takaisin-painike (Android) sulkee ylimmän dialogin.
const stack = [];
let ignorePops = 0; // ohjelmallisen sulkemisen history.back() ei saa sulkea seuraavaa dialogia
window.addEventListener('popstate', () => {
  if (ignorePops > 0) { ignorePops--; return; }
  const top = stack.at(-1);
  if (top) { top.fromHistory = true; top.dialog.close(); }
});

/**
 * Avaa modaalidialogin. Palauttaa olion, jonka close() sulkee sen.
 * @param {{title?: string, body: Node, actions?: Node[], wide?: boolean, className?: string, onClose?: Function}} opts
 */
export function openDialog({ title, body, actions = [], wide = false, className = '', onClose, headerExtra }) {
  const closeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Sulje', onclick: () => api.close() }, icon('close'));
  const dialog = h('dialog', { class: `dlg ${wide ? 'wide' : ''} ${className}` },
    h('div', { class: 'dlg-inner' },
      title != null && h('header', { class: 'dlg-head' }, h('h2', {}, title), headerExtra, closeBtn),
      h('div', { class: 'dlg-body' }, body),
      actions.length ? h('footer', { class: 'dlg-foot' }, actions) : null));
  document.body.append(dialog);

  const entry = { dialog, fromHistory: false };
  stack.push(entry);
  history.pushState({ dlg: stack.length }, '');

  dialog.addEventListener('close', () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    if (!entry.fromHistory) { ignorePops++; history.back(); }
    onClose?.(dialog.returnValue);
    dialog.remove();
  });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) api.close(); });
  dialog.showModal();

  const api = { dialog, close: (v) => { if (dialog.open) dialog.close(v); } };
  return api;
}

export function confirmDialog(message, { title = 'Vahvista', ok = 'OK', cancel = 'Peruuta', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const d = openDialog({
      title,
      body: h('p', { class: 'confirm-text' }, message),
      className: 'small',
      actions: [
        h('button', { class: 'btn', onclick: () => d.close() }, cancel),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => { result = true; d.close(); } }, ok),
      ],
      onClose: () => resolve(result),
    });
  });
}

/** Valinta useasta vaihtoehdosta. Palauttaa valitun arvon tai null. */
export function choiceDialog(message, choices, { title = 'Valitse' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const d = openDialog({
      title,
      body: h('div', {}, h('p', { class: 'confirm-text' }, message),
        h('div', { class: 'choice-list' }, choices.map((c) => h('button', {
          class: `choice ${c.danger ? 'danger' : ''}`,
          onclick: () => { result = c.value; d.close(); },
        }, h('strong', {}, c.label), c.desc && h('span', {}, c.desc))))),
      className: 'small',
      actions: [h('button', { class: 'btn', onclick: () => d.close() }, 'Peruuta')],
      onClose: () => resolve(result),
    });
  });
}

// ── Ponnahdusvalikko ────────────────────────────────────────────────────────
// Läppärillä ankkurin alle aukeava valikko, kännykällä alhaalta nouseva arkki.
let openPop = null;

export function closePopover() {
  openPop?.close();
}

export function openPopover(anchor, { title, body, onClose, className = '' }) {
  closePopover();
  if (matchMedia('(max-width: 759px)').matches) {
    const d = openDialog({ title, body, onClose, className: `sheet-pop ${className}` });
    openPop = { close: () => d.close(), el: d.dialog };
    return openPop;
  }
  const pop = h('div', { class: `popover ${className}`, role: 'dialog', 'aria-label': title || '' },
    title && h('div', { class: 'pop-head' }, h('strong', {}, title),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Sulje', onclick: () => api.close() }, icon('close', 16))),
    h('div', { class: 'pop-body' }, body));
  document.body.append(pop);

  const place = () => {
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    const below = window.innerHeight - top - 12;
    if (below < 280 && r.top > below) {
      const maxH = Math.min(r.top - 18, 560);
      pop.style.maxHeight = `${maxH}px`;
      top = Math.max(8, r.top - 6 - Math.min(pop.scrollHeight, maxH));
    } else {
      pop.style.maxHeight = `${Math.min(below, 560)}px`;
    }
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  };
  place();

  const onDown = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) api.close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); api.close(); if (anchor.isConnected) anchor.focus(); } };
  const onResize = () => api.close();
  setTimeout(() => document.addEventListener('pointerdown', onDown, true));
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);

  const api = {
    el: pop,
    close() {
      if (!pop.isConnected) return;
      pop.remove();
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      if (openPop === api) openPop = null;
      onClose?.();
    },
  };
  openPop = api;
  (pop.querySelector('input[type="search"], input[type="text"]') || pop.querySelector('button'))?.focus({ preventScroll: true });
  return api;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('fi-FI', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatMoney(n) {
  return new Intl.NumberFormat('fi-FI', { style: 'currency', currency: 'EUR' }).format(n);
}

/** Tallentaa tiedoston: kännykässä jakovalikko, muuten lataus. */
export async function saveFile(blob, filename, { share = true } = {}) {
  const file = new File([blob], filename, { type: blob.type });
  if (share && navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ files: [file], title: filename }); return; } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function pickFile(accept, { capture } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    if (capture) input.setAttribute('capture', capture);
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}
