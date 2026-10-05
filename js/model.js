// Levyt: luonti, siistiminen, validointi, tuonti ja tilastot – kaikki kenttämäärittelyn mukaan.

import {
  SYSTEM_FIELDS, normalizeValue, validateValue, defaultValues, headerIndex, fieldMap, parseNumber,
  compareValues, formatValue, uniqueKey, stripArticles,
} from './schema.js';

export { GRADES } from './schema.js';

export function newId() {
  return globalThis.crypto?.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

export function nowIso() {
  return new Date().toISOString();
}

export function emptyRecord(schema) {
  return { ...defaultValues(schema), cover_file: '' };
}

/** Siistii määrittelyn kentät; muut sarakkeet säilyvät sellaisinaan. */
export function normalizeRecord(schema, input) {
  const r = { ...input };
  for (const f of schema.fields) r[f.key] = normalizeValue(f, input[f.key]);
  return r;
}

/** @returns {Record<string,string>} kenttä → virheilmoitus */
export function validateRecord(schema, r) {
  const errors = {};
  for (const f of schema.fields) {
    if (f.hidden) continue;
    const e = validateValue(f, r[f.key] ?? '');
    if (e) errors[f.key] = e;
  }
  return errors;
}

/**
 * Kohdistaa tuotavan tiedoston sarakeotsikot kenttiin (avain, nimi tai alias).
 * @returns {{mapping: Map<string,string>, unknown: string[]}}
 */
export function mapHeaders(schema, headers) {
  const idx = headerIndex(schema);
  const mapping = new Map();
  const unknown = [];
  const used = new Set();
  for (const h of headers) {
    const name = String(h).trim();
    if (!name) continue;
    const key = idx.get(name.toLowerCase());
    if (key && !used.has(key)) { mapping.set(h, key); used.add(key); } else if (!key) unknown.push(name);
  }
  return { mapping, unknown };
}

/** Luo tekstikentät tuntemattomille sarakkeille. */
export function fieldsForHeaders(schema, headers) {
  const taken = new Set(schema.fields.map((f) => f.key));
  return headers.map((label) => {
    const key = uniqueKey(taken, label);
    taken.add(key);
    return { key, label, type: 'text', group: 'Tuodut kentät', aliases: [label.toLowerCase()] };
  });
}

// Discogsin "Format"-sarake on muotoa "2xLP, Album" tai "7\", Single".
function discogsFormat(field, raw) {
  const f = raw.toUpperCase();
  const pick = /BOX/.test(f) ? 'Boksi' : /\bEP\b/.test(f) ? 'EP' : /\b7"|SINGLE/.test(f) ? 'Single'
    : /LP\b|ALBUM/.test(f) ? 'LP' : null;
  return pick && field.options.includes(pick) ? pick : raw;
}

/** Muuntaa tuodun rivin levyksi. Palauttaa null, jos artisti ja nimi puuttuvat. */
export function fromImportRow(schema, row, mapping) {
  const fields = fieldMap(schema);
  const raw = {};
  for (const [header, key] of mapping) {
    const v = row[header];
    if (v != null && String(v).trim() !== '') raw[key] = String(v);
  }
  if (!raw.artist && !raw.title) return null;

  const out = {};
  for (const [key, v] of Object.entries(raw)) {
    const f = fields.get(key);
    if (!f) { out[key] = String(v).trim(); continue; }
    let value = v;
    if (key === 'format' && f.type === 'select' && !f.options.some((o) => o.toLowerCase() === v.trim().toLowerCase())) {
      const discs = v.match(/(\d+)\s*[x×]\s*(LP|vinyl)/i);
      if (discs && !raw.discs && fields.has('discs')) out.discs = discs[1];
      value = discogsFormat(f, v);
    }
    out[key] = normalizeValue(f, value);
  }
  for (const f of schema.fields) if ((out[f.key] ?? '') === '' && f.default != null) out[f.key] = f.default;
  out.id = raw.id || newId();
  out.created_at = raw.created_at || nowIso();
  out.updated_at = raw.updated_at || out.created_at;
  out.cover_file = raw.cover_file || '';
  return out;
}

/** Vertailuavain tuplien tunnistukseen. */
export function duplicateKey(r) {
  const norm = (s) => String(s ?? '').toLowerCase().replace(/^the\s+/, '').replace(/[^\p{L}\p{N}]/gu, '');
  return `${norm(r.artist)}|${norm(r.title)}|${norm(r.catalog_number)}`;
}

export function sortKeyArtist(name) {
  return stripArticles(name).toLowerCase();
}

/** Vapaatekstihaku: kaikkien sanojen pitää löytyä jostain kentästä. */
export function matchesQuery(r, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  let hay = '';
  for (const [k, v] of Object.entries(r)) if (!SYSTEM_FIELDS.includes(k) && v) hay += ` ${String(v).toLowerCase()}`;
  return words.every((w) => hay.includes(w));
}

const DISTRIBUTION_TYPES = ['select', 'grade', 'checkbox', 'rating'];

export function computeStats(schema, records) {
  const fields = fieldMap(schema);
  const sum = (key) => records.reduce((s, r) => s + (parseNumber(r[key]) || 0), 0);

  const distribution = (f, keyFn = (r) => r[f.key]) => {
    const counts = new Map();
    for (const r of records) {
      const k = keyFn(r);
      if (k) counts.set(k, (counts.get(k) || 0) + 1);
    }
    const entries = [...counts.entries()];
    if (DISTRIBUTION_TYPES.includes(f.type)) entries.sort((a, b) => compareValues(f, a[0], b[0]));
    else if (f.type === 'date') entries.sort((a, b) => a[0].localeCompare(b[0]));
    else entries.sort((a, b) => b[1] - a[1]);
    return entries.map(([k, n]) => [f.type === 'rating' || f.type === 'checkbox' ? formatValue(f, k) : k, n]);
  };

  const distributions = [];
  for (const f of schema.fields) {
    if (f.hidden) continue;
    if (DISTRIBUTION_TYPES.includes(f.type) || f.key === 'genre') {
      const entries = distribution(f);
      if (entries.length) distributions.push({ label: f.label, entries });
    }
    if (f.key === 'year') {
      const entries = distribution({ type: 'date' }, (r) => {
        const y = parseNumber(r.year);
        return Number.isNaN(y) ? '' : `${Math.floor(y / 10) * 10}-luku`;
      });
      if (entries.length) distributions.push({ label: 'Vuosikymmenet', entries, all: true });
    }
  }

  return {
    total: records.length,
    discs: fields.has('discs') ? records.reduce((s, r) => s + (parseNumber(r.discs) || 1), 0) : records.length,
    artists: new Set(records.map((r) => sortKeyArtist(r.artist))).size,
    withCover: records.filter((r) => r.cover_file).length,
    money: schema.fields.filter((f) => f.type === 'money' && !f.hidden).map((f) => ({ label: f.label, value: sum(f.key) })),
    distributions,
  };
}
