// Excel-tyyppinen taulukko: virtualisoidut rivit (tuhansia levyjä sujuvasti), lajittelu ja
// suodatus sarakeotsikoista, solujen muokkaus näppäimistöllä tai kosketuksella,
// kopioi/liitä (myös useita soluja Excelistä), sarakkeiden leveyden säätö ja summarivi.
//
// Näppäimet: nuolet/Tab/Home/End/PgUp/PgDn liikkuvat, Enter tai F2 muokkaa, kirjoittaminen
// korvaa arvon, Esc peruu, Delete tyhjentää, välilyönti vaihtaa valintaruudun,
// Ctrl+Enter avaa levyn tiedot, Ctrl+C / Ctrl+V kopioi ja liittää.

import { h, icon } from './ui.js';
import {
  GRADES, CHECKED, formatValue, normalizeValue, validateValue, editableText, parseNumber, formatMoney,
} from './schema.js';
import { isActive } from './query.js';

export const DEFAULT_WIDTHS = {
  text: 150, textarea: 220, number: 90, money: 105, date: 105, select: 120, grade: 80, checkbox: 80, rating: 100, url: 160,
};
const RH_W = 48; // rivin alun kansikuvasarake
const MIN_W = 56;
const BUFFER = 12;
const NUMERIC = ['number', 'money'];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function checkboxEl(on, f) {
  return h('span', { class: `dt-check${on ? ' on' : ''}`, role: 'checkbox', 'aria-checked': String(on), 'aria-label': f.label },
    on ? icon('check', 15) : null);
}

/** Piirtää arvon soluun tyypin mukaan. */
export function renderValue(td, f, v) {
  td.replaceChildren();
  td.removeAttribute('title');
  if (v === '' || v == null) {
    if (f.type === 'checkbox') td.append(checkboxEl(false, f));
    return;
  }
  let text = formatValue(f, v);
  switch (f.type) {
    case 'select': {
      const color = f.colors?.[v];
      td.append(h('span', { class: `pill${color ? ' colored' : ''}`, style: color ? { '--pill': color } : null }, v));
      break;
    }
    case 'grade':
      td.append(h('span', { class: 'grade' }, v));
      text = GRADES.find((g) => g.code === v)?.name ?? v;
      break;
    case 'checkbox':
      td.append(checkboxEl(true, f));
      return;
    case 'rating':
      td.append(h('span', { class: 'stars', 'aria-label': `${v} / 5` }, text));
      break;
    case 'url': {
      let label = String(v);
      try { label = new URL(v).hostname.replace(/^www\./, ''); } catch { /* näytä sellaisenaan */ }
      td.append(h('a', { href: v, target: '_blank', rel: 'noopener noreferrer' }, label));
      break;
    }
    case 'textarea':
      td.append(String(v).split('\n')[0]);
      break;
    default:
      td.append(text);
  }
  td.title = text;
}

export class DataTable {
  /**
   * @param {object} o
   * @param {(id: string) => void} o.onOpen
   * @param {(changes: object[], meta?: object) => void} o.onCommit
   * @param {(key: string, additive: boolean) => void} o.onSort
   * @param {(key: string, anchor: Element) => void} o.onFilter
   * @param {(key: string, width: number) => void} o.onResize
   * @param {(message: string) => void} o.onError
   * @param {(id: string) => string|null} o.thumb
   * @param {(key: string) => string[]} o.suggestions
   * @param {() => string} o.emptyText
   */
  constructor(o) {
    this.o = o;
    this.el = h('div', { class: 'dt', tabindex: '0', role: 'grid', 'aria-label': 'Levyt taulukkona' });
    this.rows = [];
    this.cols = [];
    this.sort = [];
    this.filters = {};
    this.active = null;
    this.editing = null;
    this.pending = null;
    this.rowH = 0;
    this.range = [-1, -1];
    this.lastPointer = 'mouse';

    this.el.addEventListener('scroll', () => {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => { this.raf = 0; this.renderRows(); });
    }, { passive: true });
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    this.el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('dblclick', (e) => this.onDblClick(e));
    this.el.addEventListener('copy', (e) => this.onCopy(e));
    this.el.addEventListener('paste', (e) => this.onPaste(e));
    new ResizeObserver(() => this.renderRows()).observe(this.el);
  }

  // ── Tiedot ────────────────────────────────────────────────────────────────
  update({ records, columns, sort = [], filters = {} }) {
    if (this.editing) { this.pending = { records, columns, sort, filters }; return; }
    Object.assign(this, { rows: records, cols: columns, sort, filters });
    this.datalists = new Map();
    if (this.active && (this.active.row >= this.rows.length || this.active.col >= this.cols.length)) this.active = null;
    this.build();
  }

  /** Päivittää muuttuneet levyt paikallaan (ei uudelleenrakennusta, rivien järjestys säilyy). */
  patch(updated) {
    const map = new Map(updated.map((r) => [r.id, r]));
    this.rows = this.rows.map((r) => map.get(r.id) || r);
    if (!this.tbody) return;
    for (const tr of this.tbody.querySelectorAll('tr.dt-row')) {
      const r = this.rows[Number(tr.dataset.row)];
      if (!r || !map.has(r.id)) continue;
      for (const td of tr.querySelectorAll('td.dt-td')) {
        if (this.editing?.td === td) continue;
        const f = this.cols[Number(td.dataset.col)].field;
        renderValue(td, f, r[f.key] ?? '');
      }
    }
    this.tfoot.replaceChildren(this.footerRow());
  }

  // ── Rakenne ───────────────────────────────────────────────────────────────
  build() {
    const sortInfo = new Map(this.sort.map((s, i) => [s.key, { ...s, n: i + 1 }]));
    this.colgroup = h('colgroup', {}, h('col', { style: { width: `${RH_W}px` } }),
      this.cols.map((c) => h('col', { style: { width: `${c.width}px` } })));
    this.thead = h('thead', {}, h('tr', {},
      h('th', { class: 'dt-corner sticky0', scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Kansikuva')),
      this.cols.map((c, j) => this.headerCell(c, j, sortInfo.get(c.field.key)))));
    this.tbody = h('tbody');
    this.tfoot = h('tfoot', {}, this.footerRow());
    this.table = h('table', { class: 'dt-table', style: { width: `${this.totalWidth()}px` } },
      this.colgroup, this.thead, this.tbody, this.tfoot);
    this.el.replaceChildren(this.table);
    if (!this.rows.length) this.el.append(h('div', { class: 'dt-empty' }, this.o.emptyText?.() || 'Ei rivejä'));
    this.range = [-1, -1];
    this.renderRows(true);
  }

  totalWidth() {
    return RH_W + this.cols.reduce((s, c) => s + c.width, 0);
  }

  headerCell(c, j, s) {
    const f = c.field;
    const filtered = isActive(this.filters[f.key]);
    return h('th', {
      class: `dt-th${j === 0 ? ' sticky1' : ''}${NUMERIC.includes(f.type) ? ' num' : ''}${filtered ? ' filtered' : ''}`,
      scope: 'col',
      'aria-sort': s ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none',
    },
    h('div', { class: 'dt-th-inner' },
      h('button', {
        type: 'button', class: 'dt-sort', title: `Järjestä: ${f.label} (Shift: lisäjärjestys)`,
        onclick: (e) => this.o.onSort(f.key, e.shiftKey),
      },
      h('span', { class: 'dt-label' }, f.label),
      s && h('span', { class: 'dt-sort-ind', 'aria-hidden': 'true' }, s.dir === 'asc' ? '▲' : '▼', this.sort.length > 1 ? h('sub', {}, s.n) : null)),
      h('button', {
        type: 'button', class: `dt-filter${filtered ? ' on' : ''}`, title: 'Suodata ja järjestä',
        'aria-label': `Suodata ja järjestä: ${f.label}${filtered ? ' (suodatettu)' : ''}`,
        onclick: (e) => { e.stopPropagation(); this.o.onFilter(f.key, e.currentTarget); },
      }, icon('filter', 15))),
    h('span', { class: 'dt-resize', title: 'Muuta leveyttä', onpointerdown: (e) => this.startResize(e, j) }));
  }

  footerRow() {
    return h('tr', {},
      h('td', { class: 'sticky0 dt-sum-label', 'aria-hidden': 'true' }, 'Σ'),
      this.cols.map((c, j) => {
        const f = c.field;
        let text = '';
        if (f.type === 'money' || (f.type === 'number' && f.sum)) {
          const total = this.rows.reduce((s, r) => s + (parseNumber(r[f.key]) || 0), 0);
          text = f.type === 'money' ? formatMoney(total) : String(total).replace('.', ',');
        } else if (j === 0) {
          text = `${this.rows.length} ${this.rows.length === 1 ? 'rivi' : 'riviä'}`;
        }
        return h('td', { class: `${j === 0 ? 'sticky1' : ''}${NUMERIC.includes(f.type) ? ' num' : ''}`, title: text && j ? `${f.label} yhteensä: ${text}` : null }, text);
      }));
  }

  renderRows(force = false) {
    if (!this.tbody || this.editing) return;
    if (!this.rowH) this.rowH = parseFloat(getComputedStyle(this.el).getPropertyValue('--dt-row-h')) || 40;
    const rh = this.rowH;
    const top = this.el.scrollTop;
    const viewH = this.el.clientHeight || window.innerHeight;
    const start = Math.max(0, Math.floor(top / rh) - BUFFER);
    const end = Math.min(this.rows.length, Math.ceil((top + viewH) / rh) + BUFFER);
    if (!force && start === this.range[0] && end === this.range[1]) return;
    this.range = [start, end];

    const span = this.cols.length + 1;
    const spacer = (px) => (px > 0
      ? h('tr', { class: 'dt-spacer', 'aria-hidden': 'true' }, h('td', { colspan: span, style: { height: `${px}px` } }))
      : null);
    const out = [spacer(start * rh)];
    for (let i = start; i < end; i++) out.push(this.rowEl(i));
    out.push(spacer((this.rows.length - end) * rh));
    this.tbody.replaceChildren(...out.filter(Boolean));

    // Varmistetaan, että rivikorkeus vastaa todellista (fontit, zoomaus)
    const first = this.tbody.querySelector('tr.dt-row');
    if (first && Math.abs(first.getBoundingClientRect().height - rh) > 0.5) {
      this.rowH = first.getBoundingClientRect().height;
      this.renderRows(true);
    }
  }

  rowEl(i) {
    const r = this.rows[i];
    const url = this.o.thumb(r.id);
    const tr = h('tr', { class: 'dt-row', dataset: { row: i }, 'aria-rowindex': i + 2 },
      h('td', { class: 'dt-rh sticky0' },
        h('button', {
          type: 'button', class: 'dt-open', dataset: { open: r.id }, tabindex: '-1',
          'aria-label': `Avaa tiedot: ${r.artist || ''} – ${r.title || ''}`, title: 'Avaa levyn tiedot (Ctrl+Enter)',
        }, url ? h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' }) : h('span', { class: 'dt-noimg' }, icon('disc', 18)))));
    this.cols.forEach((c, j) => {
      const f = c.field;
      const act = this.active && this.active.row === i && this.active.col === j;
      const td = h('td', {
        class: `dt-td t-${f.type}${j === 0 ? ' sticky1' : ''}${NUMERIC.includes(f.type) ? ' num' : ''}${act ? ' active' : ''}`,
        dataset: { col: j }, role: 'gridcell',
      });
      renderValue(td, f, r[f.key] ?? '');
      tr.append(td);
    });
    return tr;
  }

  // ── Valinta ───────────────────────────────────────────────────────────────
  posOf(target) {
    const td = target.closest?.('td.dt-td');
    if (!td || !this.el.contains(td)) return null;
    return { row: Number(td.parentElement.dataset.row), col: Number(td.dataset.col) };
  }

  tdAt(row, col) {
    return this.tbody?.querySelector(`tr[data-row="${row}"] > td[data-col="${col}"]`) ?? null;
  }

  current() {
    if (!this.active) return null;
    const r = this.rows[this.active.row];
    const f = this.cols[this.active.col]?.field;
    return r && f ? { r, f } : null;
  }

  setActive(row, col, { scroll = true } = {}) {
    if (!this.rows.length || !this.cols.length) return;
    row = clamp(row, 0, this.rows.length - 1);
    col = clamp(col, 0, this.cols.length - 1);
    this.el.querySelector('td.dt-td.active')?.classList.remove('active');
    this.active = { row, col };
    if (scroll) this.scrollToCell(row, col);
    this.tdAt(row, col)?.classList.add('active');
  }

  scrollToCell(row, col) {
    const el = this.el;
    const rh = this.rowH || 40;
    const headH = this.thead.offsetHeight;
    const footH = this.tfoot.offsetHeight;
    const top = row * rh;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (headH + top + rh > el.scrollTop + el.clientHeight - footH) el.scrollTop = headH + top + rh - el.clientHeight + footH;
    if (col > 0) {
      let x = RH_W;
      for (let j = 0; j < col; j++) x += this.cols[j].width;
      const stickyW = RH_W + this.cols[0].width;
      const w = this.cols[col].width;
      if (x - stickyW < el.scrollLeft) el.scrollLeft = x - stickyW;
      else if (x + w > el.scrollLeft + el.clientWidth) el.scrollLeft = x + w - el.clientWidth;
    } else {
      el.scrollLeft = el.scrollLeft; // ensimmäinen sarake on aina näkyvissä
    }
    this.renderRows();
  }

  // ── Hiiri ja kosketus ─────────────────────────────────────────────────────
  onPointerDown(e) {
    this.lastPointer = e.pointerType;
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (e.target.closest('.dt-editor, [data-open], a, thead, .dt-resize')) return;
    const pos = this.posOf(e.target);
    if (!pos) return;
    if (this.editing) {
      if (this.editing.row === pos.row && this.editing.col === pos.col) return;
      this.finishEdit(true, null, true);
    }
    this.setActive(pos.row, pos.col, { scroll: false });
    if (this.cols[pos.col].field.type === 'checkbox' && e.target.closest('.dt-check')) this.toggleCheckbox();
  }

  onClick(e) {
    const open = e.target.closest('[data-open]');
    if (open) { this.o.onOpen(open.dataset.open); return; }
    if (this.lastPointer === 'mouse') return;
    // Kosketus: napautus aloittaa muokkauksen suoraan
    if (e.target.closest('.dt-editor, a, thead')) return;
    const pos = this.posOf(e.target);
    if (!pos) return;
    if (this.editing) {
      if (this.editing.row === pos.row && this.editing.col === pos.col) return;
      this.finishEdit(true, null, true);
    }
    this.setActive(pos.row, pos.col, { scroll: false });
    if (this.cols[pos.col].field.type === 'checkbox') this.toggleCheckbox();
    else this.startEdit();
  }

  onDblClick(e) {
    if (this.lastPointer !== 'mouse' || e.target.closest('.dt-editor, thead, [data-open], a')) return;
    const pos = this.posOf(e.target);
    if (!pos || this.cols[pos.col].field.type === 'checkbox') return;
    this.setActive(pos.row, pos.col, { scroll: false });
    this.startEdit();
  }

  // ── Näppäimistö ───────────────────────────────────────────────────────────
  onKey(e) {
    if (this.editing || e.target !== this.el || !this.rows.length || !this.cols.length) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!this.active) {
      if (/^(Arrow|Enter$|Home$|End$|Page)/.test(e.key)) { e.preventDefault(); this.setActive(0, 0); }
      return;
    }
    const a = this.active;
    const page = Math.max(1, Math.floor((this.el.clientHeight - 90) / (this.rowH || 40)));
    const go = (r, c) => { e.preventDefault(); this.setActive(r, c); };
    switch (e.key) {
      case 'ArrowDown': return go(mod ? this.rows.length - 1 : a.row + 1, a.col);
      case 'ArrowUp': return go(mod ? 0 : a.row - 1, a.col);
      case 'ArrowRight': return go(a.row, mod ? this.cols.length - 1 : a.col + 1);
      case 'ArrowLeft': return go(a.row, mod ? 0 : a.col - 1);
      case 'Tab':
        if ((!e.shiftKey && a.col === this.cols.length - 1) || (e.shiftKey && a.col === 0)) return;
        return go(a.row, a.col + (e.shiftKey ? -1 : 1));
      case 'Home': return go(mod ? 0 : a.row, 0);
      case 'End': return go(mod ? this.rows.length - 1 : a.row, this.cols.length - 1);
      case 'PageDown': return go(a.row + page, a.col);
      case 'PageUp': return go(a.row - page, a.col);
      case 'Enter':
        e.preventDefault();
        if (mod) return this.o.onOpen(this.rows[a.row].id);
        return this.startEdit();
      case 'F2':
        e.preventDefault();
        return this.startEdit();
      case ' ':
        if (this.cols[a.col].field.type === 'checkbox') { e.preventDefault(); return this.toggleCheckbox(); }
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        return this.clearCell();
      default:
    }
    if (!mod && !e.altKey && e.key.length === 1) {
      e.preventDefault();
      this.startEdit({ initial: e.key });
    }
  }

  // ── Muokkaus ──────────────────────────────────────────────────────────────
  datalistFor(f) {
    if (!this.o.suggestions) return null;
    const id = `dt-dl-${f.key}`;
    if (!this.datalists.has(f.key)) {
      const dl = h('datalist', { id }, this.o.suggestions(f.key).slice(0, 500).map((v) => h('option', { value: v })));
      this.datalists.set(f.key, dl);
      this.el.append(dl);
    }
    return id;
  }

  editorFor(f, v) {
    const label = { 'aria-label': f.label };
    const opts = (list) => list.map(([value, text]) => h('option', { value, selected: value === v }, text));
    switch (f.type) {
      case 'select': {
        const list = f.options.map((o) => [o, o]);
        if (v && !f.options.includes(v)) list.push([v, v]);
        return h('select', label, h('option', { value: '' }, '–'), opts(list));
      }
      case 'grade': {
        const list = GRADES.map((g) => [g.code, `${g.code} – ${g.name}`]);
        if (v && !GRADES.some((g) => g.code === v)) list.push([v, v]);
        return h('select', label, h('option', { value: '' }, '–'), opts(list));
      }
      case 'rating':
        return h('select', label, h('option', { value: '' }, '–'), opts([1, 2, 3, 4, 5].map((n) => [String(n), '★'.repeat(n)])));
      case 'textarea': {
        const t = h('textarea', { ...label, rows: 4 });
        t.value = v;
        return t;
      }
      case 'date':
        return h('input', { ...label, type: 'date', value: v });
      case 'number':
      case 'money':
        return h('input', { ...label, type: 'text', inputmode: 'decimal', autocomplete: 'off', value: editableText(f, v) });
      case 'url':
        return h('input', { ...label, type: 'url', inputmode: 'url', autocomplete: 'off', value: v });
      default:
        return h('input', { ...label, type: 'text', autocomplete: 'off', enterkeyhint: 'done', list: this.datalistFor(f), value: v });
    }
  }

  startEdit({ initial } = {}) {
    if (!this.active || this.editing) return;
    const { row, col } = this.active;
    const r = this.rows[row];
    const f = this.cols[col].field;
    if (f.type === 'checkbox') { if (initial == null || initial === ' ') this.toggleCheckbox(); return; }
    this.scrollToCell(row, col);
    const td = this.tdAt(row, col);
    if (!td) return;

    const old = r[f.key] ?? '';
    const input = this.editorFor(f, old);
    const initialText = input.value;
    const isSelect = input.tagName === 'SELECT';
    if (initial != null) {
      if (isSelect) {
        const opt = [...input.options].find((o) => o.text.toLowerCase().startsWith(initial.toLowerCase()));
        if (opt) input.value = opt.value;
      } else if (input.type !== 'date') {
        input.value = initial;
      }
    }

    const wrap = h('div', { class: `dt-editor t-${f.type}` }, input);
    if (f.type === 'textarea') {
      const tr = td.getBoundingClientRect();
      const er = this.el.getBoundingClientRect();
      Object.assign(wrap.style, {
        left: `${tr.left - er.left + this.el.scrollLeft}px`,
        top: `${tr.top - er.top + this.el.scrollTop}px`,
        width: `${Math.max(tr.width, 300)}px`,
      });
      wrap.classList.add('overlay');
      this.el.append(wrap);
    } else {
      td.append(wrap);
    }
    td.classList.add('editing');
    this.editing = { row, col, id: r.id, field: f, input, wrap, td, old, initialText, mode: initial != null ? 'enter' : 'edit' };

    input.addEventListener('keydown', (e) => this.onEditorKey(e));
    input.addEventListener('blur', () => setTimeout(() => {
      if (this.editing?.input === input && document.activeElement !== input) this.finishEdit(true, null, true);
    }, 0));
    if (isSelect) input.addEventListener('change', () => this.finishEdit(true, null));

    input.focus({ preventScroll: true });
    if (!isSelect && input.type !== 'date') {
      const n = input.value.length;
      try { input.setSelectionRange(n, n); } catch { /* jotkin tyypit eivät tue */ }
    }
    if (isSelect || (input.type === 'date' && this.lastPointer !== 'mouse')) {
      try { input.showPicker(); } catch { /* ei tuettu tai ei käyttäjän toimintoa */ }
    }
  }

  onEditorKey(e) {
    const ed = this.editing;
    if (!ed) return;
    const isArea = ed.input.tagName === 'TEXTAREA';
    switch (e.key) {
      case 'Escape':
        e.preventDefault(); e.stopPropagation();
        this.finishEdit(false);
        break;
      case 'Enter':
        if (isArea && !(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        this.finishEdit(true, e.shiftKey ? 'up' : 'down');
        break;
      case 'Tab':
        e.preventDefault();
        this.finishEdit(true, e.shiftKey ? 'left' : 'right');
        break;
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight':
        // Kirjoitustilassa nuolet hyväksyvät ja siirtyvät (kuten Excelissä)
        if (ed.mode === 'enter' && ed.input.tagName === 'INPUT' && ed.input.type !== 'date') {
          e.preventDefault();
          this.finishEdit(true, e.key.slice(5).toLowerCase());
        }
        break;
      default:
    }
  }

  /** @returns {boolean} false, jos arvo oli virheellinen ja muokkaus jatkuu */
  finishEdit(save, move = null, fromBlur = false) {
    const ed = this.editing;
    if (!ed) return true;
    let change = null;
    if (save && ed.input.value !== ed.initialText) {
      const value = normalizeValue(ed.field, ed.input.value);
      if (value !== ed.old) {
        const err = validateValue(ed.field, value);
        if (err) {
          this.o.onError(`${ed.field.label}: ${err}`);
          if (!fromBlur) {
            ed.input.setAttribute('aria-invalid', 'true');
            ed.input.focus();
            return false;
          }
        } else {
          change = { id: ed.id, key: ed.field.key, value, old: ed.old };
        }
      }
    }
    this.editing = null;
    ed.wrap.remove();
    ed.td.classList.remove('editing');
    if (change) this.o.onCommit([change]);
    if (this.pending) { const p = this.pending; this.pending = null; this.update(p); }
    if (move) {
      const [dr, dc] = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[move];
      this.setActive(ed.row + dr, ed.col + dc);
    }
    if (!fromBlur) this.el.focus({ preventScroll: true });
    this.renderRows(true);
    return true;
  }

  toggleCheckbox() {
    const cur = this.current();
    if (!cur) return;
    const old = cur.r[cur.f.key] ?? '';
    this.o.onCommit([{ id: cur.r.id, key: cur.f.key, value: old ? '' : CHECKED, old }]);
  }

  clearCell() {
    const cur = this.current();
    if (!cur) return;
    const old = cur.r[cur.f.key] ?? '';
    if (old === '') return;
    if (cur.f.required) { this.o.onError(`${cur.f.label} on pakollinen`); return; }
    this.o.onCommit([{ id: cur.r.id, key: cur.f.key, value: '', old }]);
  }

  // ── Leikepöytä ────────────────────────────────────────────────────────────
  /** Leikepöytätapahtuma kohdistuu valittuun soluun tai itse taulukkoon – ei muokkauskenttään. */
  ownsClipboardEvent(e) {
    return !this.editing && this.el.contains(e.target) && !e.target.closest?.('.dt-editor, input, textarea, select');
  }

  onCopy(e) {
    if (!this.ownsClipboardEvent(e)) return;
    const cur = this.current();
    if (!cur) return;
    e.clipboardData.setData('text/plain', editableText(cur.f, cur.r[cur.f.key] ?? ''));
    e.preventDefault();
  }

  /** Liittää yhden arvon tai Excelistä kopioidun alueen (sarkaimin eroteltu) aktiivisesta solusta alkaen. */
  onPaste(e) {
    if (!this.ownsClipboardEvent(e) || !this.active) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    const grid = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((line) => line.split('\t'));
    const changes = [];
    let skipped = 0;
    grid.forEach((cells, i) => cells.forEach((cell, j) => {
      const row = this.active.row + i;
      const col = this.active.col + j;
      if (row >= this.rows.length || col >= this.cols.length) { skipped++; return; }
      const r = this.rows[row];
      const f = this.cols[col].field;
      const value = normalizeValue(f, cell);
      if (validateValue(f, value)) { skipped++; return; }
      const old = r[f.key] ?? '';
      if (value !== old) changes.push({ id: r.id, key: f.key, value, old });
    }));
    if (changes.length) this.o.onCommit(changes, { paste: true, skipped });
    else if (skipped) this.o.onError(`Liitettäviä arvoja ei voitu käyttää (${skipped} virheellistä)`);
  }

  // ── Sarakkeen leveys ──────────────────────────────────────────────────────
  startResize(e, j) {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = this.cols[j].width;
    const col = this.colgroup.children[j + 1];
    const move = (ev) => {
      const w = Math.max(MIN_W, Math.round(startW + ev.clientX - startX));
      this.cols[j] = { ...this.cols[j], width: w };
      col.style.width = `${w}px`;
      this.table.style.width = `${this.totalWidth()}px`;
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      if (this.cols[j].width !== startW) this.o.onResize(this.cols[j].field.key, this.cols[j].width);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }
}
