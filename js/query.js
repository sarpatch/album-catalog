// Suodatus ja lajittelu minkä tahansa kentän mukaan (Excelin automaattisuodatuksen tapaan).
//
// Suodatin on yksi seuraavista:
//   { values: ['Varastossa', ''] }   – sallitut arvot ('' = tyhjä)
//   { min: '10', max: '50' }         – väli (luvut, rahasummat, päivämäärät)
//   { contains: 'live' }             – sisältää tekstin
// Lajittelu on lista: [{ key: 'year', dir: 'desc' }, { key: 'artist', dir: 'asc' }]

import { fieldMap, compareValues, formatValue, parseNumber } from './schema.js';
import { matchesQuery } from './model.js';

/** Järjestelmän aikaleimat, joiden mukaan voi myös lajitella. */
export const SYSTEM_SORT_FIELDS = [
  { key: 'created_at', label: 'Lisätty', type: 'date' },
  { key: 'updated_at', label: 'Muokattu', type: 'date' },
];

export function filterKind(field) {
  if (['number', 'money', 'date'].includes(field.type)) return 'range';
  if (['textarea', 'url'].includes(field.type)) return 'contains';
  return 'values';
}

const filled = (v) => v != null && String(v).trim() !== '';

export function isActive(f) {
  return !!f && (Array.isArray(f.values) || filled(f.min) || filled(f.max) || filled(f.contains));
}

export function matchesFilter(field, value, f) {
  const v = value ?? '';
  if (Array.isArray(f.values) && !f.values.includes(v)) return false;
  if (filled(f.contains) && !String(v).toLowerCase().includes(String(f.contains).toLowerCase())) return false;
  if (filled(f.min) || filled(f.max)) {
    if (v === '') return false;
    if (field.type === 'date') {
      if (filled(f.min) && v < f.min) return false;
      if (filled(f.max) && v > f.max) return false;
    } else {
      const n = parseNumber(v);
      if (Number.isNaN(n)) return false;
      if (filled(f.min) && n < parseNumber(f.min)) return false;
      if (filled(f.max) && n > parseNumber(f.max)) return false;
    }
  }
  return true;
}

function sortFieldMap(schema) {
  const m = fieldMap(schema);
  for (const f of SYSTEM_SORT_FIELDS) m.set(f.key, f);
  return m;
}

/** Lajittelee; tyhjät arvot ovat aina viimeisinä. Tasatilanteessa artisti → vuosi → nimi. */
export function sortRecords(records, schema, sort = []) {
  const fields = sortFieldMap(schema);
  const keys = sort.filter((s) => fields.has(s.key));
  const tie = ['artist', 'year', 'title'].filter((k) => fields.has(k) && !keys.some((s) => s.key === k))
    .map((key) => ({ key, dir: 'asc' }));
  const order = [...keys, ...tie];
  return [...records].sort((a, b) => {
    for (const { key, dir } of order) {
      const va = a[key] ?? ''; const vb = b[key] ?? '';
      if (va === '' && vb === '') continue;
      if (va === '') return 1;
      if (vb === '') return -1;
      const c = compareValues(fields.get(key), va, vb);
      if (c) return dir === 'desc' ? -c : c;
    }
    return 0;
  });
}

export function applyView(records, schema, { query = '', filters = {}, sort = [] } = {}) {
  const fields = fieldMap(schema);
  const active = Object.entries(filters || {}).filter(([k, f]) => fields.has(k) && isActive(f));
  const out = records.filter((r) => matchesQuery(r, query) &&
    active.every(([k, f]) => matchesFilter(fields.get(k), r[k], f)));
  return sortRecords(out, schema, sort);
}

/** Kentän erilaiset arvot lukumäärineen, lajiteltuna kentän järjestykseen. Tyhjä viimeisenä. */
export function valueCounts(records, field) {
  const counts = new Map();
  for (const r of records) {
    const v = r[field.key] ?? '';
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => {
    if (a === '') return 1;
    if (b === '') return -1;
    return compareValues(field, a, b);
  });
}

export function activeFilterCount(schema, filters) {
  const fields = fieldMap(schema);
  return Object.entries(filters || {}).filter(([k, f]) => fields.has(k) && isActive(f)).length;
}

/** Lyhyt kuvaus suodattimesta, esim. "Varastossa, Tilattu" tai "10–50 €". */
export function describeFilter(field, f) {
  const parts = [];
  if (Array.isArray(f.values)) {
    const shown = f.values.slice(0, 2).map((v) => (v === '' ? '(tyhjä)' : formatValue(field, v)));
    parts.push(f.values.length ? shown.join(', ') + (f.values.length > 2 ? ` +${f.values.length - 2}` : '') : 'ei mitään');
  }
  if (filled(f.min) || filled(f.max)) {
    const fmt = (x) => (filled(x) ? formatValue(field, field.type === 'date' ? x : String(parseNumber(x))) : '');
    parts.push(filled(f.min) && filled(f.max) ? `${fmt(f.min)} – ${fmt(f.max)}` : filled(f.min) ? `≥ ${fmt(f.min)}` : `≤ ${fmt(f.max)}`);
  }
  if (filled(f.contains)) parts.push(`”${f.contains}”`);
  return parts.join(' · ');
}

export function sortLabels(field) {
  if (['number', 'money', 'rating'].includes(field.type)) return ['Pienin ensin', 'Suurin ensin'];
  if (field.type === 'date') return ['Vanhin ensin', 'Uusin ensin'];
  if (['select', 'grade'].includes(field.type)) return ['Listan järjestys', 'Käänteinen'];
  return ['A → Ö', 'Ö → A'];
}
