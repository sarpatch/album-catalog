// RFC 4180 -yhteensopiva CSV-jäsennin ja -kirjoitin.
// Tukee lainausmerkkejä, rivinvaihtoja kentissä, CRLF/LF-rivinvaihtoja,
// UTF-8 BOM:ia sekä pilkku- ja puolipiste-erottimia (suomalainen Excel).

const FORMULA_START = /^[=+\-@\t\r]/;

/** Arvaa erotinmerkin otsikkorivin perusteella. */
export function detectDelimiter(text) {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? best : ',';
}

/** Jäsentää CSV-tekstin taulukoksi (rivit → kentät). */
export function parseCSV(text, delimiter) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delim = delimiter ?? detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { inQuotes = true; i++; continue; }
    if (ch === delim) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch; i++;
  }
  if (inQuotes) throw new Error('CSV-virhe: lainausmerkki jäi sulkematta');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  // Poista täysin tyhjät rivit
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

/** Jäsentää CSV:n olioiksi otsikkorivin avaimilla. */
export function parseCSVObjects(text, delimiter) {
  const rows = parseCSV(text, delimiter);
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const records = rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = unescapeFormula(r[idx] ?? ''); });
    return obj;
  });
  return { headers, records };
}

function escapeFormula(value) {
  // Suojaus CSV/kaava-injektiota vastaan, kun tiedosto avataan taulukkolaskennassa.
  return FORMULA_START.test(value) && !/^-?\d+([.,]\d+)?$/.test(value) ? `'${value}` : value;
}

function unescapeFormula(value) {
  return value.length > 1 && value[0] === "'" && FORMULA_START.test(value.slice(1))
    ? value.slice(1)
    : value;
}

function quote(value, delim) {
  const s = escapeFormula(value == null ? '' : String(value));
  return /["\r\n]/.test(s) || s.includes(delim) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Muuntaa oliot CSV-tekstiksi. Lisää BOM:in, jotta Excel tunnistaa UTF-8:n. */
export function toCSV(headers, records, { delimiter = ',', bom = true } = {}) {
  const lines = [headers.map((h) => quote(h, delimiter)).join(delimiter)];
  for (const rec of records) {
    lines.push(headers.map((h) => quote(rec[h], delimiter)).join(delimiter));
  }
  return (bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}
