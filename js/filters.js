// Suodatin- ja järjestysvalikko yhdelle kentälle (Excelin automaattisuodattimen tapaan):
// arvolista valintaruuduin ja haulla, väli luvuille/päivämäärille tai "sisältää"-teksti.

import { h, debounce } from './ui.js';
import { formatValue, GRADES } from './schema.js';
import { filterKind, valueCounts, sortLabels, isActive } from './query.js';

const MAX_ITEMS = 300;

/**
 * @param {object} p
 * @param {object} p.field
 * @param {object[]} p.records  rivit, joihin on sovellettu muiden kenttien suodattimet
 * @param {object|undefined} p.filter
 * @param {(f: object|undefined) => void} p.onChange
 * @param {'asc'|'desc'|null} [p.sortDir]
 * @param {(dir: 'asc'|'desc') => void} [p.onSort]
 */
export function filterEditor({ field, records, filter, onChange, sortDir = null, onSort }) {
  const kind = filterKind(field);
  let current = filter ? structuredClone(filter) : undefined;
  const body = h('div', { class: 'fx-body' });
  const clearBtn = h('button', {
    type: 'button', class: 'btn btn-small btn-text', disabled: !isActive(current),
    onclick: () => { current = undefined; emit(); draw(); },
  }, 'Tyhjennä suodatin');
  const emit = () => {
    onChange(isActive(current) ? current : undefined);
    clearBtn.disabled = !isActive(current);
  };

  const sortRow = onSort && (() => {
    const [ascL, descL] = sortLabels(field);
    const btn = (dir, text) => h('button', {
      type: 'button', class: `btn btn-small${sortDir === dir ? ' on' : ''}`, 'aria-pressed': String(sortDir === dir),
      onclick: (e) => {
        sortDir = dir;
        e.currentTarget.parentElement.querySelectorAll('.btn').forEach((b) => {
          const on = b === e.currentTarget;
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', String(on));
        });
        onSort(dir);
      },
    }, dir === 'asc' ? '▲ ' : '▼ ', text);
    return h('div', { class: 'fx-sort' }, btn('asc', ascL), btn('desc', descL));
  })();

  const label = (v) => {
    if (v === '') return '(Tyhjä)';
    if (field.type === 'grade') { const g = GRADES.find((x) => x.code === v); return g ? `${v} – ${g.name}` : v; }
    return formatValue(field, v);
  };

  function drawValues() {
    const counts = valueCounts(records, field);
    const all = counts.map(([v]) => v);
    const selected = new Set(Array.isArray(current?.values) ? current.values : all);
    let q = '';
    const visible = () => counts.filter(([v]) => !q || label(v).toLowerCase().includes(q));

    const search = h('input', { type: 'search', class: 'fx-search', placeholder: 'Hae arvoja…', 'aria-label': `Hae arvoja: ${field.label}`, autocomplete: 'off' });
    const master = h('input', { type: 'checkbox' });
    const masterText = h('span', {}, 'Valitse kaikki');
    const list = h('div', { class: 'fx-list', role: 'group', 'aria-label': 'Arvot' });
    const containsBtn = h('button', {
      type: 'button', class: 'btn btn-small', hidden: true,
      onclick: () => { current = { contains: search.value.trim() }; emit(); draw(); },
    });

    const apply = () => {
      current = selected.size === all.length ? undefined : { values: all.filter((v) => selected.has(v)) };
      emit();
      syncMaster();
    };
    const syncMaster = () => {
      const items = visible();
      const on = items.filter(([v]) => selected.has(v)).length;
      master.checked = items.length > 0 && on === items.length;
      master.indeterminate = on > 0 && on < items.length;
    };
    const renderList = () => {
      const items = visible();
      list.replaceChildren(
        ...items.slice(0, MAX_ITEMS).map(([v, n]) => h('label', { class: 'fx-item' },
          h('input', {
            type: 'checkbox', checked: selected.has(v),
            onchange: (e) => { if (e.target.checked) selected.add(v); else selected.delete(v); apply(); },
          }),
          h('span', { class: `fx-val${v === '' ? ' empty' : ''}` }, label(v)),
          h('span', { class: 'fx-n' }, n))),
        items.length > MAX_ITEMS ? h('p', { class: 'hint' }, `Näytetään ${MAX_ITEMS} / ${items.length} – tarkenna hakua`) : '',
        items.length ? '' : h('p', { class: 'hint' }, 'Ei osumia'));
      syncMaster();
    };

    master.addEventListener('change', () => {
      for (const [v] of visible()) { if (master.checked) selected.add(v); else selected.delete(v); }
      apply();
      renderList();
    });
    search.addEventListener('input', () => {
      q = search.value.trim().toLowerCase();
      masterText.textContent = q ? 'Valitse kaikki hakutulokset' : 'Valitse kaikki';
      containsBtn.hidden = !q || field.type !== 'text';
      containsBtn.textContent = `Suodata: sisältää ”${search.value.trim()}”`;
      renderList();
    });

    body.replaceChildren(
      search,
      current?.contains ? h('p', { class: 'fx-note' }, `Nyt suodatettu: sisältää ”${current.contains}”`) : '',
      h('label', { class: 'fx-item fx-master' }, master, masterText),
      list,
      containsBtn);
    renderList();
  }

  function drawRange() {
    const isDate = field.type === 'date';
    const values = valueCounts(records, field).filter(([v]) => v !== '');
    const input = (k, text) => h('label', { class: 'field' }, h('span', {}, text),
      h('input', {
        type: isDate ? 'date' : 'text', inputmode: isDate ? null : 'decimal', autocomplete: 'off',
        value: current?.[k] ?? '', placeholder: isDate ? null : (k === 'min' ? 'esim. 10' : 'esim. 50'),
        oninput: debounce((e) => { current = { ...current, [k]: e.target.value.trim() }; delete current.values; emit(); }, 250),
      }));
    body.replaceChildren(
      h('div', { class: 'fx-range' }, input('min', isDate ? 'Alkaen' : 'Vähintään'), input('max', isDate ? 'Asti' : 'Enintään')),
      values.length ? h('p', { class: 'hint' }, `Arvot: ${label(values[0][0])} – ${label(values.at(-1)[0])}`) : '');
  }

  function drawContains() {
    body.replaceChildren(h('label', { class: 'field' }, h('span', {}, 'Sisältää tekstin'),
      h('input', {
        type: 'search', autocomplete: 'off', value: current?.contains ?? '',
        oninput: debounce((e) => { current = { contains: e.target.value }; emit(); }, 250),
      })));
  }

  function draw() {
    if (kind === 'values') drawValues();
    else if (kind === 'range') drawRange();
    else drawContains();
    clearBtn.disabled = !isActive(current);
  }
  draw();

  return h('div', { class: 'fx' }, sortRow, body, h('div', { class: 'fx-foot' }, clearBtn));
}
