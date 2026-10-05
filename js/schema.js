// Kenttämäärittely (kentat.json): kenttätyypit, arvojen siistiminen, validointi,
// näyttömuotoilu ja vertailu. Kaikki kenttiä koskeva logiikka on tässä, joten
// uusi kenttä toimii lomakkeessa, taulukossa, suodatuksessa ja CSV:ssä ilman koodimuutoksia.

export const SCHEMA_FILE = 'kentat.json';

/** Sarakkeet, joita sovellus ylläpitää itse. Näitä ei voi käyttää kenttien nimenä. */
export const SYSTEM_FIELDS = ['id', 'cover_file', 'created_at', 'updated_at'];

export const TYPES = {
  text: 'Teksti',
  textarea: 'Pitkä teksti',
  number: 'Numero',
  money: 'Rahasumma (€)',
  date: 'Päivämäärä',
  select: 'Valintalista',
  grade: 'Kuntoluokka (Goldmine)',
  checkbox: 'Kyllä / ei',
  rating: 'Tähtiarvio 1–5',
  url: 'Linkki',
};

/** Goldmine-kuntoluokitus – alan vakiintunut asteikko. */
export const GRADES = [
  { code: 'M', name: 'Mint', desc: 'Täysin uudenveroinen, avaamaton' },
  { code: 'NM', name: 'Near Mint', desc: 'Lähes virheetön, ei näkyviä jälkiä' },
  { code: 'VG+', name: 'Very Good Plus', desc: 'Vähäisiä käytön jälkiä, ei vaikuta soittoon' },
  { code: 'VG', name: 'Very Good', desc: 'Näkyviä jälkiä, lievää rätinää hiljaisissa kohdissa' },
  { code: 'G+', name: 'Good Plus', desc: 'Selvää kulumaa ja pintakohinaa, soi läpi' },
  { code: 'G', name: 'Good', desc: 'Runsas kuluma, kuuntelukelpoinen' },
  { code: 'F', name: 'Fair', desc: 'Vaurioitunut, hyppii tai rahisee pahoin' },
  { code: 'P', name: 'Poor', desc: 'Lähes soittokelvoton' },
];
const GRADE_CODES = GRADES.map((g) => g.code);

export const CHECKED = 'kyllä';
const TRUTHY = ['1', 'true', 'kyllä', 'kylla', 'k', 'x', 'yes', 'y', 'on', '✓', '✔'];

/** Artisti ja levyn nimi ovat aina mukana – niihin perustuvat kortit, tuplatarkistus ja haku. */
export const CORE_FIELDS = [
  { key: 'artist', label: 'Artisti', type: 'text', group: 'Perustiedot', required: true, sortIgnoreArticles: true },
  { key: 'title', label: 'Levyn nimi', type: 'text', group: 'Perustiedot', required: true },
];
export const FALLBACK_SCHEMA = { version: 1, updated_at: '', fields: CORE_FIELDS };

const SCHEMA_HELP = [
  'Levyhyllyn kenttämäärittely. Muokkaa vapaasti – muutos näkyy sovelluksessa seuraavassa synkronoinnissa.',
  'Tyypit: text, textarea, number, money, date, select, grade, checkbox, rating, url.',
  'Ominaisuudet: key (pysyvä sarakkeen nimi CSV:ssä – älä muuta jälkikäteen), label (näkyvä nimi), type, group (lomakkeen osio),',
  'required, table (false = piilossa taulukosta oletuksena), hidden (true = piilota kokonaan, tiedot säilyvät), default,',
  'options ja colors (select), min, max, decimals, sum (summarivi), width (sarakkeen leveys px), aliases (tuonnin sarakenimet), help.',
].join(' ');

export function slugify(text) {
  const s = String(text ?? '').toLowerCase()
    .replace(/[äå]/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!s) return '';
  return /^[a-z]/.test(s) ? s : `f_${s}`;
}

/** Palauttaa kenttäavaimen, jota ei vielä ole käytössä. */
export function uniqueKey(taken, wanted) {
  const used = taken instanceof Set ? taken : new Set(taken);
  const base = slugify(wanted) || 'kentta';
  if (!used.has(base) && !SYSTEM_FIELDS.includes(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}

const asList = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean)
  : typeof v === 'string' ? v.split(/[\n,;]/).map((x) => x.trim()).filter(Boolean) : []);
const asNumber = (v) => { if (v === '' || v == null) return undefined; const n = Number(v); return Number.isFinite(n) ? n : undefined; };

/**
 * Tarkistaa ja siistii kenttämäärittelyn. Ei koskaan heitä virhettä: viallisista
 * kohdista tulee varoitus, ja ne ohitetaan tai korjataan.
 * @returns {{schema: object, warnings: string[]}}
 */
export function normalizeSchema(raw) {
  const warnings = [];
  const input = raw && typeof raw === 'object' ? raw : {};
  const list = Array.isArray(input) ? input : Array.isArray(input.fields) ? input.fields : [];
  if (!list.length) warnings.push('Kenttälista puuttuu tai on tyhjä');

  const fields = [];
  const seen = new Set();
  list.forEach((f, i) => {
    if (!f || typeof f !== 'object') { warnings.push(`Kenttä #${i + 1} ei ole kelvollinen`); return; }
    let key = String(f.key ?? '').trim();
    if (!/^[a-z][a-z0-9_]*$/.test(key)) key = slugify(key || f.label);
    if (!key) { warnings.push(`Kentältä #${i + 1} puuttuu key ja label`); return; }
    if (SYSTEM_FIELDS.includes(key)) { warnings.push(`"${key}" on varattu nimi – kenttä ohitettiin`); return; }
    if (seen.has(key)) { warnings.push(`Kenttä "${key}" on määritelty kahdesti – jälkimmäinen ohitettiin`); return; }

    let type = String(f.type ?? 'text');
    if (!TYPES[type]) { warnings.push(`Kentän "${key}" tyyppi "${type}" on tuntematon – käytetään tekstiä`); type = 'text'; }
    const field = { key, label: String(f.label ?? '').trim() || key, type, group: String(f.group ?? '').trim() || 'Muut' };

    if (type === 'select') {
      field.options = [...new Set(asList(f.options))];
      if (!field.options.length) {
        warnings.push(`Valintakentältä "${key}" puuttuvat vaihtoehdot – käytetään tekstiä`);
        field.type = 'text'; delete field.options;
      } else if (f.colors && typeof f.colors === 'object') {
        const colors = Object.fromEntries(Object.entries(f.colors)
          .filter(([, c]) => typeof c === 'string' && /^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(c.trim())));
        if (Object.keys(colors).length) field.colors = colors;
      }
    }
    if (f.required) field.required = true;
    if (f.table === false) field.table = false;
    if (f.hidden) field.hidden = true;
    for (const k of ['min', 'max', 'decimals', 'width']) { const n = asNumber(f[k]); if (n !== undefined) field[k] = n; }
    if (f.sum) field.sum = true;
    if (f.sortIgnoreArticles) field.sortIgnoreArticles = true;
    if (f.default != null && String(f.default) !== '') field.default = String(f.default);
    if (f.help) field.help = String(f.help);
    if (f.placeholder) field.placeholder = String(f.placeholder);
    const aliases = asList(f.aliases).map((a) => a.toLowerCase());
    if (aliases.length) field.aliases = aliases;

    seen.add(key);
    fields.push(field);
  });

  for (const core of [...CORE_FIELDS].reverse()) {
    if (!seen.has(core.key)) {
      warnings.push(`Pakollinen kenttä "${core.key}" puuttui ja lisättiin`);
      fields.unshift({ ...core });
    }
  }
  for (const core of CORE_FIELDS) {
    const f = fields.find((x) => x.key === core.key);
    delete f.hidden;
  }
  return { schema: { version: 1, updated_at: String(input.updated_at ?? ''), fields }, warnings };
}

/** Jäsentää kentat.json-tekstin. Heittää virheen vain, jos JSON on rikki. */
export function parseSchema(text) {
  let raw;
  try {
    raw = JSON.parse(String(text).replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`kentat.json ei ole kelvollista JSONia (${e.message})`);
  }
  return normalizeSchema(raw);
}

/** Kirjoittaa määrittelyn käsin muokattavaan muotoon: yksi ominaisuus riville, listat yhdelle riville. */
export function schemaToJSON(schema) {
  const text = JSON.stringify({ _ohje: SCHEMA_HELP, version: 1, updated_at: schema.updated_at || '', fields: schema.fields }, null, 2);
  const inline = (m) => m.replace(/\s*\n\s*/g, ' ').replace(/\[ /, '[').replace(/ \]$/, ']').replace(/\{ /, '{ ').replace(/ \}$/, ' }');
  return `${text
    .replace(/\[\s*\n(?:\s*(?:"(?:[^"\\]|\\.)*"|-?[\d.]+|true|false|null),?\s*\n)+\s*\]/g, inline)
    .replace(/\{\s*\n(?:\s*"(?:[^"\\]|\\.)*": "(?:[^"\\]|\\.)*",?\s*\n)+\s*\}(?=,?\n\s*[}"\]])/g, (m) => (m.includes('"key"') ? m : inline(m)))}\n`;
}

/** Lisää perusmäärittelyyn ne kentät, joita siinä ei vielä ole. */
export function mergeSchemas(base, extra) {
  const keys = new Set(base.fields.map((f) => f.key));
  const added = extra.fields.filter((f) => !keys.has(f.key));
  return { schema: { ...base, fields: [...base.fields, ...added] }, added };
}

export const fieldMap = (schema) => new Map(schema.fields.map((f) => [f.key, f]));

// ── Arvot ───────────────────────────────────────────────────────────────────

/** Lukee luvun sallivasti: "12,50 €", "1 234,5", "1.234,50", "1977 (UK)". */
export function parseNumber(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[\s €]/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '');
  s = s.replace(',', '.');
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

export function normalizeDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? (Number(m[3]) > 50 ? `19${m[3]}` : `20${m[3]}`) : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return s;
}

/** Normalisoi kuntoluokan, esim. "Very Good Plus (VG+)" → "VG+". Tuntematon → ''. */
export function normalizeGrade(value) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  const paren = v.match(/\(([^)]+)\)/);
  const candidate = (paren ? paren[1] : v).toUpperCase().replace(/\s+/g, '').replace(/ORM-$/, '');
  if (GRADE_CODES.includes(candidate)) return candidate;
  const byName = GRADES.find((g) => g.name.toUpperCase() === v.toUpperCase());
  if (byName) return byName.code;
  return candidate === 'EX' ? 'VG+' : candidate === 'M-' ? 'NM' : '';
}

/** Siistii arvon kentän tyypin mukaiseen tallennusmuotoon. Tuntemattomat arvot säilytetään. */
export function normalizeValue(field, value) {
  const s = value == null ? '' : String(value).trim();
  if (!s) return '';
  switch (field.type) {
    case 'number': {
      const n = parseNumber(s);
      if (Number.isNaN(n)) return s;
      return String(field.decimals != null ? Number(n.toFixed(field.decimals)) : n);
    }
    case 'money': {
      const n = parseNumber(s);
      return Number.isNaN(n) ? s : n.toFixed(2);
    }
    case 'date': return normalizeDate(s);
    case 'grade': return normalizeGrade(s) || s;
    case 'select': return field.options.find((o) => o.toLowerCase() === s.toLowerCase()) ?? s;
    case 'checkbox': return TRUTHY.includes(s.toLowerCase()) ? CHECKED : '';
    case 'rating': {
      const stars = (s.match(/[★*]/g) || []).length;
      const n = stars || Math.round(parseNumber(s));
      return n >= 1 ? String(Math.min(5, n)) : '';
    }
    case 'url':
      return /^[a-z][a-z0-9+.-]*:/i.test(s) || !/^[\w-]+(\.[\w-]+)+/.test(s) ? s : `https://${s}`;
    case 'textarea': return String(value).replace(/\r\n?/g, '\n').trim();
    default: return s.replace(/\s+/g, ' ');
  }
}

/** Palauttaa virheilmoituksen tai tyhjän merkkijonon. */
export function validateValue(field, v) {
  if (v === '' || v == null) return field.required ? `${field.label} on pakollinen` : '';
  switch (field.type) {
    case 'number':
    case 'money': {
      const n = Number(v);
      if (!Number.isFinite(n)) return 'Anna luku, esim. 12,50';
      if (field.min != null && n < field.min) return `Pienin sallittu arvo on ${field.min}`;
      if (field.max != null && n > field.max) return `Suurin sallittu arvo on ${field.max}`;
      return '';
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? '' : 'Anna päivämäärä, esim. 24.12.2021';
    case 'grade': return GRADE_CODES.includes(v) ? '' : 'Tuntematon kuntoluokka (M, NM, VG+, VG, G+, G, F, P)';
    case 'rating': return /^[1-5]$/.test(v) ? '' : 'Arvio on 1–5';
    case 'url':
      try { new URL(v); return ''; } catch { return 'Virheellinen osoite'; }
    default: return '';
  }
}

const moneyFmt = new Intl.NumberFormat('fi-FI', { style: 'currency', currency: 'EUR' });
export const formatMoney = (n) => moneyFmt.format(n);

/** Arvo näytettävässä muodossa. */
export function formatValue(field, v) {
  if (v === '' || v == null) return '';
  switch (field.type) {
    case 'money': { const n = parseNumber(v); return Number.isNaN(n) ? String(v) : moneyFmt.format(n); }
    case 'number': { const n = parseNumber(v); return Number.isNaN(n) ? String(v) : String(n).replace('.', ','); }
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
      return m ? `${Number(m[3])}.${Number(m[2])}.${m[1]}` : String(v);
    }
    case 'checkbox': return v ? 'Kyllä' : '';
    case 'rating': { const n = Math.max(0, Math.min(5, Math.round(parseNumber(v)) || 0)); return '★'.repeat(n) + '☆'.repeat(5 - n); }
    default: return String(v);
  }
}

/** Arvo tekstinä, joka on helppo liittää taulukkolaskentaan tai muokata. */
export function editableText(field, v) {
  if (v === '' || v == null) return '';
  if (field.type === 'money' || field.type === 'number') return String(v).replace('.', ',');
  if (field.type === 'date') return formatValue(field, v);
  return String(v);
}

const collator = new Intl.Collator('fi', { numeric: true, sensitivity: 'base' });
export const stripArticles = (s) => String(s ?? '').trim().replace(/^(the|a|an)\s+/i, '');
const indexIn = (arr, v) => { const i = arr.indexOf(v); return i < 0 ? arr.length : i; };

/** Vertailee kahta ei-tyhjää arvoa kentän tyypin mukaan. */
export function compareValues(field, a, b) {
  switch (field.type) {
    case 'number': case 'money': case 'rating': {
      const na = parseNumber(a); const nb = parseNumber(b);
      if (Number.isNaN(na) || Number.isNaN(nb)) return Number.isNaN(na) - Number.isNaN(nb) || collator.compare(String(a), String(b));
      return na - nb;
    }
    case 'date': return String(a).localeCompare(String(b));
    case 'grade': return indexIn(GRADE_CODES, a) - indexIn(GRADE_CODES, b);
    case 'select': return indexIn(field.options, a) - indexIn(field.options, b) || collator.compare(String(a), String(b));
    default:
      return field.sortIgnoreArticles
        ? collator.compare(stripArticles(a), stripArticles(b))
        : collator.compare(String(a), String(b));
  }
}

export function defaultValues(schema) {
  return Object.fromEntries(schema.fields.map((f) => [f.key, f.default ?? '']));
}

/** CSV:n sarakkeet: id, kentät määrittelyn järjestyksessä, muut tallessa olevat sarakkeet, järjestelmäsarakkeet. */
export function csvColumns(schema, records) {
  const cols = ['id', ...schema.fields.map((f) => f.key)];
  const seen = new Set([...cols, 'cover_file', 'created_at', 'updated_at']);
  for (const r of records) for (const k of Object.keys(r)) if (k && !seen.has(k)) { seen.add(k); cols.push(k); }
  return [...cols, 'cover_file', 'created_at', 'updated_at'];
}

/** Sarakeotsikko (pienillä kirjaimilla) → kenttäavain: avain, näkyvä nimi tai alias. */
export function headerIndex(schema) {
  const m = new Map(SYSTEM_FIELDS.map((k) => [k, k]));
  for (const f of schema.fields) m.set(f.key, f.key);
  for (const f of schema.fields) {
    for (const n of [f.label.toLowerCase(), ...(f.aliases || [])]) if (!m.has(n)) m.set(n, f.key);
  }
  return m;
}
