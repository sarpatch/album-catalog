// Levyn tietomalli, validointi ja tuonnin kenttävastaavuudet.

/** CSV-sarakkeet tässä järjestyksessä. Nimet englanniksi yhteensopivuuden vuoksi. */
export const FIELDS = [
  'id', 'artist', 'title', 'year', 'label', 'catalog_number', 'format', 'size',
  'speed_rpm', 'discs', 'country', 'genre', 'style', 'media_grade', 'sleeve_grade',
  'barcode', 'discogs_id', 'location', 'purchase_date', 'purchase_price',
  'purchase_place', 'notes', 'cover_file', 'created_at', 'updated_at',
];

export const LABELS = {
  artist: 'Artisti', title: 'Levyn nimi', year: 'Vuosi', label: 'Levy-yhtiö',
  catalog_number: 'Tuotenumero', format: 'Formaatti', size: 'Koko', speed_rpm: 'Nopeus',
  discs: 'Levyjä', country: 'Maa', genre: 'Genre', style: 'Tyyli',
  media_grade: 'Levyn kunto', sleeve_grade: 'Kannen kunto', barcode: 'Viivakoodi',
  discogs_id: 'Discogs ID', location: 'Sijainti hyllyssä', purchase_date: 'Ostopäivä',
  purchase_price: 'Hinta (€)', purchase_place: 'Ostopaikka', notes: 'Muistiinpanot',
};

export const FORMATS = ['LP', 'EP', 'Single', 'Maxi-single', 'Boksi', 'Muu'];
export const SIZES = ['12"', '10"', '7"'];
export const SPEEDS = ['33', '45', '78'];

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

/** Tuonnin otsikkovastaavuudet: omat, suomenkieliset ja Discogs-viennin sarakkeet. */
const ALIASES = {
  artist: ['artist', 'artisti', 'esittäjä', 'yhtye'],
  title: ['title', 'nimi', 'levy', 'albumi', 'levyn nimi', 'album'],
  year: ['year', 'vuosi', 'released', 'julkaisuvuosi'],
  label: ['label', 'levy-yhtiö', 'levymerkki'],
  catalog_number: ['catalog_number', 'catalog#', 'catno', 'tuotenumero', 'cat no'],
  format: ['format', 'formaatti'],
  size: ['size', 'koko'],
  speed_rpm: ['speed_rpm', 'speed', 'rpm', 'nopeus'],
  discs: ['discs', 'levyjä', 'levyjen määrä'],
  country: ['country', 'maa'],
  genre: ['genre'],
  style: ['style', 'tyyli'],
  media_grade: ['media_grade', 'collection media condition', 'media condition', 'levyn kunto'],
  sleeve_grade: ['sleeve_grade', 'collection sleeve condition', 'sleeve condition', 'kannen kunto'],
  barcode: ['barcode', 'viivakoodi', 'ean', 'upc'],
  discogs_id: ['discogs_id', 'release_id'],
  location: ['location', 'sijainti', 'hylly', 'collectionfolder'],
  purchase_date: ['purchase_date', 'ostopäivä', 'date added'],
  purchase_price: ['purchase_price', 'hinta', 'ostohinta', 'price'],
  purchase_place: ['purchase_place', 'ostopaikka'],
  notes: ['notes', 'muistiinpanot', 'huomiot', 'collection notes'],
  cover_file: ['cover_file', 'kansikuva'],
  id: ['id'],
  created_at: ['created_at'],
  updated_at: ['updated_at'],
};

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

export function emptyRecord() {
  const r = Object.fromEntries(FIELDS.map((f) => [f, '']));
  r.format = 'LP'; r.size = '12"'; r.speed_rpm = '33'; r.discs = '1';
  return r;
}

/** Normalisoi kuntoluokan, esim. "Very Good Plus (VG+)" → "VG+". */
export function normalizeGrade(value) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  const paren = v.match(/\(([^)]+)\)/);
  const candidate = (paren ? paren[1] : v).toUpperCase().replace(/\s+/g, '');
  if (GRADE_CODES.includes(candidate)) return candidate;
  const byName = GRADES.find((g) => g.name.toUpperCase() === v.toUpperCase());
  return byName ? byName.code : candidate === 'EX' ? 'VG+' : '';
}

function normalizePrice(value) {
  const v = String(value ?? '').trim().replace(/[€\s]/g, '').replace(',', '.');
  if (!v) return '';
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : String(value).trim();
}

function normalizeDate(value) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const fi = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (fi) return `${fi[3]}-${fi[2].padStart(2, '0')}-${fi[1].padStart(2, '0')}`;
  return v;
}

/** Siistii kentät yhtenäiseen muotoon. Ei muuta id:tä eikä aikaleimoja. */
export function normalizeRecord(input) {
  const r = emptyRecord();
  for (const f of FIELDS) if (input[f] != null) r[f] = String(input[f]).trim();
  r.year = (r.year.match(/\d{4}/) || [''])[0];
  r.media_grade = normalizeGrade(r.media_grade);
  r.sleeve_grade = normalizeGrade(r.sleeve_grade);
  r.purchase_price = normalizePrice(r.purchase_price);
  r.purchase_date = normalizeDate(r.purchase_date);
  r.speed_rpm = (r.speed_rpm.match(/\d+/) || [''])[0];
  r.discs = (r.discs.match(/\d+/) || [''])[0];
  return r;
}

/** Palauttaa virheet muodossa { kenttä: viesti }. Tyhjä olio = kelvollinen. */
export function validateRecord(r) {
  const errors = {};
  if (!r.artist?.trim()) errors.artist = 'Artisti on pakollinen';
  if (!r.title?.trim()) errors.title = 'Levyn nimi on pakollinen';
  if (r.year) {
    const y = Number(r.year);
    const max = new Date().getFullYear() + 1;
    if (!/^\d{4}$/.test(r.year) || y < 1890 || y > max) errors.year = `Vuoden pitää olla 1890–${max}`;
  }
  if (r.purchase_price && !/^\d+(\.\d{1,2})?$/.test(r.purchase_price)) {
    errors.purchase_price = 'Anna hinta numerona, esim. 12,50';
  }
  if (r.purchase_date && !/^\d{4}-\d{2}-\d{2}$/.test(r.purchase_date)) {
    errors.purchase_date = 'Päivämäärä muodossa vvvv-kk-pp';
  }
  if (r.discs && !(Number(r.discs) >= 1)) errors.discs = 'Vähintään 1';
  for (const g of ['media_grade', 'sleeve_grade']) {
    if (r[g] && !GRADE_CODES.includes(r[g])) errors[g] = 'Tuntematon kuntoluokka';
  }
  return errors;
}

/** Muuntaa tuodun rivin (vapaat otsikot) levyksi. Palauttaa null, jos rivi on tyhjä. */
export function fromImportRow(row) {
  const lowered = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]),
  );
  const mapped = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const hit = names.find((n) => lowered[n] != null && String(lowered[n]).trim() !== '');
    if (hit) mapped[field] = lowered[hit];
  }
  // Discogs: "Format" sisältää esim. "LP, Album" → tunnista formaatti
  if (mapped.format && !FORMATS.includes(mapped.format)) {
    const f = mapped.format.toUpperCase();
    mapped.format = /BOX/.test(f) ? 'Boksi' : /\bEP\b/.test(f) ? 'EP'
      : /\b7"|SINGLE/.test(f) ? 'Single' : /LP\b|ALBUM/.test(f) ? 'LP' : 'Muu';
    const discs = String(row.Format ?? row.format ?? '').match(/(\d+)\s*[x×]?\s*LP/i);
    if (discs && !mapped.discs) mapped.discs = discs[1];
  }
  if (!mapped.artist && !mapped.title) return null;
  const rec = normalizeRecord(mapped);
  rec.id = mapped.id || newId();
  rec.created_at = mapped.created_at || nowIso();
  rec.updated_at = mapped.updated_at || rec.created_at;
  return rec;
}

/** Vertailuavain tuplien tunnistukseen. */
export function duplicateKey(r) {
  const norm = (s) => String(s ?? '').toLowerCase().replace(/^the\s+/, '').replace(/[^\p{L}\p{N}]/gu, '');
  return `${norm(r.artist)}|${norm(r.title)}|${norm(r.catalog_number)}`;
}

/** Artistin lajitteluavain: "The Beatles" → "beatles". */
export function sortKeyArtist(name) {
  return String(name ?? '').trim().toLowerCase().replace(/^(the|a|an)\s+/, '');
}

const collator = new Intl.Collator('fi', { numeric: true, sensitivity: 'base' });

export const SORTS = {
  artist: { label: 'Artisti A–Ö', cmp: (a, b) => collator.compare(sortKeyArtist(a.artist), sortKeyArtist(b.artist)) || (a.year || '9999').localeCompare(b.year || '9999') || collator.compare(a.title, b.title) },
  title: { label: 'Levyn nimi A–Ö', cmp: (a, b) => collator.compare(a.title, b.title) },
  year: { label: 'Vuosi (vanhin ensin)', cmp: (a, b) => (a.year || '9999').localeCompare(b.year || '9999') },
  yearDesc: { label: 'Vuosi (uusin ensin)', cmp: (a, b) => (b.year || '0').localeCompare(a.year || '0') },
  added: { label: 'Viimeksi lisätyt', cmp: (a, b) => b.created_at.localeCompare(a.created_at) },
  location: { label: 'Sijainti', cmp: (a, b) => collator.compare(a.location, b.location) },
};

/** Vapaatekstihaku: kaikkien sanojen pitää löytyä jostain kentästä. */
export function matchesQuery(r, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [r.artist, r.title, r.label, r.catalog_number, r.genre, r.style, r.year,
    r.country, r.location, r.notes, r.barcode].join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function computeStats(records) {
  const count = (key) => {
    const m = new Map();
    for (const r of records) {
      const k = typeof key === 'function' ? key(r) : r[key];
      if (k) m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const value = records.reduce((s, r) => s + (Number(r.purchase_price) || 0), 0);
  return {
    total: records.length,
    discs: records.reduce((s, r) => s + (Number(r.discs) || 1), 0),
    artists: new Set(records.map((r) => sortKeyArtist(r.artist))).size,
    value,
    withCover: records.filter((r) => r.cover_file).length,
    byGenre: count('genre'),
    byDecade: count((r) => (r.year ? `${r.year.slice(0, 3)}0-luku` : '')).sort((a, b) => a[0].localeCompare(b[0])),
    byFormat: count('format'),
    byGrade: count('media_grade'),
  };
}
