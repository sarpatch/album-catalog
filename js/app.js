// Levyhylly – sovelluksen pääosa: tila, näkymät ja toiminnot.
// Kaikki kenttiä koskeva tulee kenttämäärittelystä (kentat.json), joten uudet kentät
// toimivat lomakkeessa, taulukossa, suodatuksessa, tilastoissa ja CSV:ssä ilman koodimuutoksia.

import { db, requestPersistence } from './db.js';
import { CONFIG } from './config.js';
import {
  GRADES, CHECKED, SCHEMA_FILE, FALLBACK_SCHEMA, normalizeSchema, parseSchema, schemaToJSON, mergeSchemas,
  fieldMap, formatValue, formatMoney, editableText, csvColumns, SYSTEM_FIELDS,
} from './schema.js';
import {
  emptyRecord, newId, nowIso, normalizeRecord, validateRecord, fromImportRow, mapHeaders, fieldsForHeaders,
  duplicateKey, computeStats,
} from './model.js';
import {
  applyView, sortRecords, isActive, activeFilterCount, describeFilter, SYSTEM_SORT_FIELDS,
} from './query.js';
import { parseCSVObjects, toCSV } from './csv.js';
import { createZip, readZip } from './zip.js';
import { makeThumb, shortHash, coverPath } from './image.js';
import { openCropper } from './cropper.js';
import { SyncEngine, recordsToCSV, CSV_NAME } from './sync.js';
import { BACKENDS, getBackend } from './backends/index.js';
import { dropboxBackend } from './backends/dropbox.js';
import { DataTable, DEFAULT_WIDTHS, renderValue } from './table.js';
import { filterEditor } from './filters.js';
import { openFieldEditor } from './fieldeditor.js';
import {
  THEMES, AUTO_THEME, CUSTOM_ID, FONT_NAMES, resolveTheme, applyTheme, customTheme, themeVars,
} from './themes.js';
import {
  h, icon, toast, openDialog, confirmDialog, choiceDialog, openPopover, closePopover, debounce, formatDate,
  saveFile, pickFile,
} from './ui.js';

const VERSION = '1.1.0';

// ── Tila ───────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  backend: 'local',
  dropboxAppKey: CONFIG.dropboxAppKey,
  googleClientId: CONFIG.googleClientId,
  remoteFolder: CONFIG.remoteFolder,
  theme: 'auto',
  customTheme: { scheme: 'light', bg: '#faf7f2', text: '#1d1c1a', accent: '#7c3aed', font: 'sans', radius: '12px' },
  view: 'grid',
  sort: [],
  filters: {},
  columns: {},
  lastExportAt: null,
};

const state = {
  settings: structuredClone(DEFAULT_SETTINGS),
  schema: normalizeSchema(FALLBACK_SCHEMA).schema,
  schemaCustom: false,
  schemaWarnings: [],
  records: [],
  thumbs: new Map(), // id → object URL
  query: '',
  frozenIds: null, // taulukossa muokattaessa rivien järjestys pidetään paikallaan
  undo: [],
  table: null,
};

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const $ = (sel) => document.querySelector(sel);
const fields = () => fieldMap(state.schema);
const visibleFields = () => state.schema.fields.filter((f) => !f.hidden);

const sync = new SyncEngine({
  store: db,
  makeThumb,
  onStatus: renderSyncStatus,
  getSchema: () => state.schema,
  setSchema: (schema) => applySchema(schema, { sync: false }),
});
const scheduleSync = debounce(() => sync.sync().then(afterSync), 2500);

async function saveSettings(patch = {}) {
  Object.assign(state.settings, patch);
  await db.setMeta('settings', state.settings);
}

function currentBackend() {
  return getBackend(state.settings.backend, state.settings);
}

function migrateSettings(s) {
  if (typeof s.sort === 'string') {
    s.sort = {
      title: [{ key: 'title', dir: 'asc' }], year: [{ key: 'year', dir: 'asc' }], yearDesc: [{ key: 'year', dir: 'desc' }],
      added: [{ key: 'created_at', dir: 'desc' }], location: [{ key: 'location', dir: 'asc' }],
    }[s.sort] || [];
  }
  if (!Array.isArray(s.sort)) s.sort = [];
  if (s.view === 'list') s.view = 'table';
  s.filters = s.filters && typeof s.filters === 'object' ? s.filters : {};
  s.columns = s.columns && typeof s.columns === 'object' ? s.columns : {};
  return s;
}

// ── Teema ──────────────────────────────────────────────────────────────────
function refreshTheme() {
  applyTheme(resolveTheme(state.settings, darkQuery.matches));
}
darkQuery.addEventListener('change', refreshTheme);

// ── Kenttämäärittely ────────────────────────────────────────────────────────
async function siteSchema() {
  try {
    const res = await fetch(SCHEMA_FILE, { cache: 'no-cache' });
    if (res.ok) {
      const { schema, warnings } = parseSchema(await res.text());
      state.schemaWarnings = warnings;
      return schema;
    }
  } catch (e) {
    console.warn('kentat.json-tiedostoa ei voitu ladata', e);
  }
  return normalizeSchema(FALLBACK_SCHEMA).schema;
}

async function loadSchema() {
  const saved = await db.getMeta('schema', null);
  if (saved?.fields) {
    state.schema = normalizeSchema(saved).schema;
    state.schemaCustom = true;
  } else {
    state.schema = await siteSchema();
  }
}

/** Ottaa uuden kenttämäärittelyn käyttöön (sovelluksesta, tuonnista tai synkronoinnista). */
async function applySchema(schema, { sync: doSync = true } = {}) {
  state.schema = schema;
  state.schemaCustom = true;
  await db.setMeta('schema', schema);
  state.frozenIds = null;
  render();
  if (doSync) scheduleSync();
}

async function resetSchema() {
  if (!(await confirmDialog('Kentät palautetaan sovelluksen oletuksiin. Omien kenttien arvot säilyvät CSV-tiedostossa.', { title: 'Palauta oletuskentät', ok: 'Palauta' }))) return false;
  await db.setMeta('schema', null);
  state.schemaCustom = false;
  const s = await siteSchema();
  s.updated_at = nowIso();
  await applySchema(s);
  await db.setMeta('schema', null);
  state.schemaCustom = false;
  toast('Oletuskentät palautettu');
  return true;
}

function schemaLocationText() {
  const b = currentBackend();
  return b.id === 'local' ? 'tällä laitteella' : `${b.label}: ${state.settings.remoteFolder || ''}/${SCHEMA_FILE}`.replace('//', '/');
}

function exportSchema() {
  saveFile(new Blob([schemaToJSON(state.schema)], { type: 'application/json' }), SCHEMA_FILE, { share: false });
}

async function importSchema() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  try {
    const { schema, warnings } = parseSchema(await file.text());
    if (!(await confirmDialog(`Nykyiset ${state.schema.fields.length} kenttää korvataan tiedoston ${schema.fields.length} kentällä. Levyjen tiedot säilyvät.${warnings.length ? `\n\nHuomautukset:\n• ${warnings.join('\n• ')}` : ''}`, { title: 'Tuo kentat.json', ok: 'Korvaa kentät' }))) return;
    schema.updated_at = nowIso();
    await applySchema(schema);
    toast('Kentät tuotu');
  } catch (e) {
    toast(e.message, { kind: 'error', timeout: 8000 });
  }
}

function openFields() {
  closePopover();
  openFieldEditor({
    schema: state.schema,
    locationText: schemaLocationText(),
    onSave: async (schema, warnings) => {
      await applySchema(schema);
      toast(warnings.length ? `Kentät tallennettu. Huom: ${warnings[0]}` : 'Kentät tallennettu');
    },
    onExport: exportSchema,
    onImport: importSchema,
    onReset: resetSchema,
  });
}

// ── Tietojen lataus ─────────────────────────────────────────────────────────
async function loadAll() {
  state.records = await db.allRecords();
  for (const url of state.thumbs.values()) URL.revokeObjectURL(url);
  state.thumbs.clear();
  for (const c of await db.allCovers()) {
    if (c.thumb) state.thumbs.set(c.id, URL.createObjectURL(c.thumb));
  }
}

async function afterSync(result) {
  if (!result) return;
  if (result.schema?.error) toast(`${SCHEMA_FILE}: ${result.schema.error}`, { kind: 'error', timeout: 10000 });
  if (result.schema?.warnings?.length) {
    state.schemaWarnings = result.schema.warnings;
    if (result.schema.changed) toast(`Kentät päivitetty. Huom: ${result.schema.warnings[0]}`, { timeout: 8000 });
  } else if (result.schema?.changed) {
    state.schemaWarnings = [];
    toast('Kenttämäärittely päivittyi');
  }
  if (result.changed) {
    await loadAll();
    state.frozenIds = null;
    render();
  }
}

// ── Näkymän tiedot ──────────────────────────────────────────────────────────
function freshView() {
  return applyView(state.records, state.schema, { query: state.query, filters: state.settings.filters, sort: state.settings.sort });
}

function visibleRecords() {
  if (state.frozenIds) {
    const byId = new Map(state.records.map((r) => [r.id, r]));
    return state.frozenIds.map((id) => byId.get(id)).filter(Boolean);
  }
  return freshView();
}

function tableColumns() {
  return visibleFields()
    .filter((f) => !(state.settings.columns[f.key]?.hidden ?? f.table === false))
    .map((f) => ({ field: f, width: state.settings.columns[f.key]?.width ?? f.width ?? DEFAULT_WIDTHS[f.type] ?? 140 }));
}

function uniqueValues(key) {
  return [...new Set(state.records.map((r) => r[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'fi'));
}

function setFilter(key, f) {
  const filters = { ...state.settings.filters };
  if (f) filters[key] = f; else delete filters[key];
  state.settings.filters = filters;
  state.frozenIds = null;
  saveSettings();
  render();
}

function clearFilters() {
  state.query = '';
  $('#search').value = '';
  state.settings.filters = {};
  state.frozenIds = null;
  saveSettings();
  render();
}

function setSort(sort) {
  state.settings.sort = sort;
  state.frozenIds = null;
  saveSettings();
  render();
}

/** Otsikon napautus: nouseva → laskeva → ei järjestystä. Shift lisää toissijaisen järjestyksen. */
function toggleSort(key, additive) {
  let sort = [...state.settings.sort];
  const i = sort.findIndex((s) => s.key === key);
  if (!additive) {
    const cur = sort[0]?.key === key ? sort[0].dir : null;
    sort = cur === 'asc' ? [{ key, dir: 'desc' }] : cur === 'desc' ? [] : [{ key, dir: 'asc' }];
  } else if (i < 0) sort.push({ key, dir: 'asc' });
  else if (sort[i].dir === 'asc') sort[i] = { key, dir: 'desc' };
  else sort.splice(i, 1);
  setSort(sort);
}

// ── Muokkaus taulukossa ─────────────────────────────────────────────────────
async function commitChanges(changes, { paste = false, skipped = 0, undo = false } = {}) {
  if (!changes.length) return;
  if (!state.frozenIds && state.settings.view === 'table') state.frozenIds = visibleRecords().map((r) => r.id);
  const byId = new Map(state.records.map((r) => [r.id, r]));
  const touched = new Map();
  const now = nowIso();
  for (const c of changes) {
    const base = touched.get(c.id) || byId.get(c.id);
    if (base) touched.set(c.id, { ...base, [c.key]: c.value, updated_at: now });
  }
  if (!touched.size) return;
  state.records = state.records.map((r) => touched.get(r.id) || r);
  if (!undo) {
    state.undo.push(changes);
    if (state.undo.length > 100) state.undo.shift();
  }
  state.table?.patch([...touched.values()]);
  renderChrome();
  try {
    await db.putRecords([...touched.values()]);
  } catch (e) {
    toast(`Tallennus epäonnistui: ${e.message}`, { kind: 'error' });
    return;
  }
  scheduleSync();
  if (paste) {
    toast(`Liitetty ${changes.length} ${changes.length === 1 ? 'arvo' : 'arvoa'}${skipped ? `, ${skipped} ohitettu virheellisinä` : ''}`, { action: 'Kumoa', onAction: undoLast });
  }
}

function undoLast() {
  const last = state.undo.pop();
  if (!last) { toast('Ei kumottavaa'); return; }
  commitChanges([...last].reverse().map((c) => ({ id: c.id, key: c.key, value: c.old, old: c.value })), { undo: true });
  toast('Muutos kumottu');
}

function createTable() {
  return new DataTable({
    onOpen: (id) => openDetail(id),
    onCommit: (changes, meta) => commitChanges(changes, meta),
    onSort: toggleSort,
    onFilter: (key, anchor) => openFieldFilter(key, anchor),
    onResize: (key, width) => {
      state.settings.columns = { ...state.settings.columns, [key]: { ...state.settings.columns[key], width } };
      saveSettings();
    },
    onError: (msg) => toast(msg, { kind: 'error' }),
    thumb: (id) => state.thumbs.get(id) || null,
    suggestions: uniqueValues,
    emptyText: () => 'Ei osumia nykyisellä haulla ja suodattimilla.',
  });
}

// ── Suodatusvalikot ─────────────────────────────────────────────────────────
function recordsForFilter(key) {
  const others = { ...state.settings.filters };
  delete others[key];
  return applyView(state.records, state.schema, { query: state.query, filters: others });
}

function openFieldFilter(key, anchor) {
  const field = fields().get(key);
  if (!field) return;
  const primary = state.settings.sort[0];
  openPopover(anchor, {
    title: field.label,
    className: 'filter-pop',
    body: filterEditor({
      field,
      records: recordsForFilter(key),
      filter: state.settings.filters[key],
      onChange: (f) => setFilter(key, f),
      sortDir: primary?.key === key ? primary.dir : null,
      onSort: (dir) => setSort([{ key, dir }]),
    }),
  });
}

function openFilterPanel() {
  const F = visibleFields();
  const body = h('div', { class: 'filter-panel' },
    h('p', { class: 'hint' }, 'Suodata minkä tahansa kentän mukaan. Taulukkonäkymässä saman valikon saa myös sarakeotsikon suppilosta.'),
    F.map((field) => {
      const desc = h('span', { class: 'fp-desc' });
      const setDesc = () => {
        const f = state.settings.filters[field.key];
        desc.textContent = isActive(f) ? describeFilter(field, f) : '';
      };
      setDesc();
      const det = h('details', { class: 'fp-item' }, h('summary', {}, h('span', {}, field.label), desc));
      det.addEventListener('toggle', () => {
        if (!det.open || det.dataset.built) return;
        det.dataset.built = '1';
        det.append(filterEditor({
          field,
          records: recordsForFilter(field.key),
          filter: state.settings.filters[field.key],
          onChange: (f) => { setFilter(field.key, f); setDesc(); },
        }));
      });
      return det;
    }));
  const d = openDialog({
    title: 'Suodata',
    wide: true,
    body,
    actions: [
      h('button', { class: 'btn btn-text', onclick: () => { clearFilters(); d.close(); } }, 'Tyhjennä kaikki'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-primary', onclick: () => d.close() }, 'Valmis'),
    ],
  });
}

function openColumns(anchor) {
  const draw = () => visibleFields().map((f) => {
    const shown = !(state.settings.columns[f.key]?.hidden ?? f.table === false);
    return h('label', { class: 'fx-item' },
      h('input', {
        type: 'checkbox', checked: shown,
        onchange: (e) => {
          state.settings.columns = { ...state.settings.columns, [f.key]: { ...state.settings.columns[f.key], hidden: !e.target.checked } };
          saveSettings();
          render();
        },
      }),
      h('span', { class: 'fx-val' }, f.label));
  });
  const list = h('div', { class: 'fx-list cols' }, draw());
  openPopover(anchor, {
    title: 'Näytettävät sarakkeet',
    className: 'filter-pop',
    body: h('div', { class: 'fx' }, list,
      h('div', { class: 'fx-foot' },
        h('button', {
          type: 'button', class: 'btn btn-small btn-text',
          onclick: () => {
            state.settings.columns = Object.fromEntries(Object.entries(state.settings.columns).map(([k, v]) => [k, { width: v.width }]));
            saveSettings(); render(); list.replaceChildren(...draw());
          },
        }, 'Oletukset'),
        h('button', { type: 'button', class: 'btn btn-small', onclick: openFields }, icon('fields', 16), 'Muokkaa kenttiä…'))),
  });
}

// ── Päänäkymä ───────────────────────────────────────────────────────────────
function placeholderCover(r) {
  const initials = (r.artist || '?').replace(/^the\s+/i, '').slice(0, 2).toUpperCase();
  return h('div', { class: 'cover placeholder', 'aria-hidden': 'true' },
    h('div', { class: 'ph-disc' }), h('span', {}, initials));
}

function coverEl(r, cls = '') {
  const url = state.thumbs.get(r.id);
  return url
    ? h('img', { class: `cover ${cls}`, src: url, alt: '', loading: 'lazy', decoding: 'async' })
    : placeholderCover(r);
}

/** Ensimmäinen värikoodattu valintakenttä, jonka arvo poikkeaa oletuksesta → merkki kortin kulmaan. */
function badgeFor(r) {
  for (const f of visibleFields()) {
    if (f.type === 'select' && f.colors && r[f.key] && r[f.key] !== f.default) {
      return h('span', { class: 'card-badge', style: f.colors[r[f.key]] ? { '--pill': f.colors[r[f.key]] } : null }, r[f.key]);
    }
  }
  return null;
}

function card(r) {
  const F = fields();
  const meta = [
    F.has('year') && r.year,
    F.has('format') && r.format !== F.get('format').default && r.format,
    F.has('media_grade') && r.media_grade,
  ].filter(Boolean).join(' · ');
  return h('button', { class: 'card', onclick: () => openDetail(r.id), 'aria-label': `${r.artist}: ${r.title}` },
    h('div', { class: 'card-cover' }, coverEl(r), badgeFor(r)),
    h('div', { class: 'card-text' },
      h('div', { class: 'card-title' }, r.title),
      h('div', { class: 'card-artist' }, r.artist),
      meta && h('div', { class: 'card-meta' }, meta)));
}

function renderToolbar() {
  const sortSel = $('#sort');
  const primary = state.settings.sort[0];
  sortSel.replaceChildren(
    h('option', { value: '' }, 'Oletusjärjestys'),
    h('optgroup', { label: 'Kentät' }, visibleFields().map((f) => h('option', { value: f.key }, f.label))),
    h('optgroup', { label: 'Muut' }, SYSTEM_SORT_FIELDS.map((f) => h('option', { value: f.key }, f.label))));
  sortSel.value = primary?.key ?? '';
  if (sortSel.value !== (primary?.key ?? '')) sortSel.value = '';
  const dirBtn = $('#sort-dir');
  dirBtn.disabled = !primary;
  dirBtn.replaceChildren(icon(primary?.dir === 'desc' ? 'sortDesc' : 'sortAsc'));
  dirBtn.setAttribute('aria-label', primary?.dir === 'desc' ? 'Laskeva järjestys – vaihda nousevaksi' : 'Nouseva järjestys – vaihda laskevaksi');
  dirBtn.title = dirBtn.getAttribute('aria-label');

  const n = activeFilterCount(state.schema, state.settings.filters);
  $('#filter-toggle').dataset.count = n || '';
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.settings.view)));
  $('#btn-columns').hidden = state.settings.view !== 'table';
}

function renderChips() {
  const host = $('#chips');
  const F = fields();
  const chips = [];
  for (const [key, f] of Object.entries(state.settings.filters)) {
    const field = F.get(key);
    if (!field || !isActive(f)) continue;
    chips.push(h('span', { class: 'chip-filter' },
      h('button', { type: 'button', class: 'chip-main', onclick: (e) => openFieldFilter(key, e.currentTarget) },
        h('strong', {}, field.label), `: ${describeFilter(field, f)}`),
      h('button', { type: 'button', class: 'chip-x', 'aria-label': `Poista suodatin: ${field.label}`, onclick: () => setFilter(key, undefined) }, icon('close', 14))));
  }
  if (state.query) {
    chips.push(h('span', { class: 'chip-filter' },
      h('span', { class: 'chip-main' }, h('strong', {}, 'Haku'), `: ”${state.query}”`),
      h('button', { type: 'button', class: 'chip-x', 'aria-label': 'Tyhjennä haku', onclick: () => { state.query = ''; $('#search').value = ''; state.frozenIds = null; render(); } }, icon('close', 14))));
  }
  if (chips.length > 1) chips.push(h('button', { type: 'button', class: 'btn btn-small btn-text', onclick: clearFilters }, 'Tyhjennä kaikki'));
  if (state.frozenIds) {
    const fresh = freshView().map((r) => r.id);
    if (fresh.length !== state.frozenIds.length || fresh.some((id, i) => id !== state.frozenIds[i])) {
      chips.push(h('button', {
        type: 'button', class: 'chip-refresh', title: 'Muokatut rivit pysyvät paikallaan, kunnes päivität',
        onclick: () => { state.frozenIds = null; render(); },
      }, icon('refresh', 16), 'Päivitä järjestys ja suodatus'));
    }
  }
  host.hidden = !chips.length;
  host.replaceChildren(...chips);
}

/** Yläpalkki, työkalurivi ja suodatinsirut – ei itse kokoelmaa. */
function renderChrome() {
  const total = state.records.length;
  const shown = visibleRecords().length;
  $('#count').textContent = total ? (shown === total ? `${total} levyä` : `${shown} / ${total} levyä`) : '';
  renderToolbar();
  renderChips();
  renderBanner();
}

function render() {
  renderChrome();
  const list = visibleRecords();
  const main = $('#collection');
  const total = state.records.length;
  const tableMode = state.settings.view === 'table' && total > 0;
  document.body.classList.toggle('table-mode', tableMode);

  if (!total) {
    main.className = 'empty';
    main.replaceChildren(h('div', { class: 'empty-state' },
      h('div', { class: 'empty-disc' }),
      h('h2', {}, 'Hylly on vielä tyhjä'),
      h('p', {}, 'Lisää ensimmäinen levy ja ota kannesta kuva – tai tuo olemassa oleva luettelo CSV-tiedostosta (myös Excel ja Discogsin vienti käyvät).'),
      h('div', { class: 'empty-actions' },
        h('button', { class: 'btn btn-primary', onclick: () => openEditor() }, icon('plus'), 'Lisää levy'),
        h('button', { class: 'btn', onclick: importFile }, icon('upload'), 'Tuo tiedosto'),
        state.settings.backend === 'local' && h('button', { class: 'btn', onclick: () => openSettings('storage') }, icon('cloud'), 'Yhdistä pilveen'))));
    return;
  }

  if (tableMode) {
    main.className = 'table';
    state.table ??= createTable();
    if (state.table.el.parentElement !== main) main.replaceChildren(state.table.el);
    state.table.update({ records: list, columns: tableColumns(), sort: state.settings.sort, filters: state.settings.filters });
    return;
  }

  main.className = 'grid';
  if (!list.length) {
    main.className = 'empty';
    main.replaceChildren(h('div', { class: 'empty-state small' },
      h('p', {}, 'Haulla ja suodattimilla ei löytynyt levyjä.'),
      h('button', { class: 'btn', onclick: clearFilters }, 'Tyhjennä haku ja suodattimet')));
    return;
  }
  main.replaceChildren(...list.map(card));
}

function renderBanner() {
  const el = $('#banner');
  const s = state.settings;
  const days = s.lastExportAt ? (Date.now() - new Date(s.lastExportAt)) / 864e5 : Infinity;
  if (s.backend === 'local' && state.records.length >= 5 && days > 14 && !sessionStorage.getItem('bannerHidden')) {
    el.hidden = false;
    el.replaceChildren(icon('alert'),
      h('span', {}, 'Kokoelma on vain tällä laitteella. Ota varmuuskopio tai yhdistä pilveen.'),
      h('button', { class: 'btn btn-small', onclick: () => exportData('zip') }, 'Varmuuskopioi'),
      h('button', { class: 'btn btn-small', onclick: () => openSettings('storage') }, 'Pilveen'),
      h('button', { class: 'icon-btn', 'aria-label': 'Piilota', onclick: () => { sessionStorage.setItem('bannerHidden', '1'); el.hidden = true; } }, icon('close', 16)));
  } else {
    el.hidden = true;
  }
}

// ── Synkronoinnin tila ──────────────────────────────────────────────────────
function renderSyncStatus(st) {
  const el = $('#sync-status');
  if (!el) return;
  const label = { local: 'Vain laite', idle: 'Pilvi', syncing: 'Synkronoidaan…', ok: 'Synkronoitu', offline: 'Offline', login: 'Kirjaudu', error: 'Virhe' }[st.state];
  const ic = { local: 'disc', offline: 'cloudOff', login: 'login', error: 'alert', syncing: 'sync' }[st.state] || 'cloud';
  el.dataset.state = st.state;
  el.title = st.message || (st.at ? `Viimeksi ${formatDate(st.at)}` : currentBackend().describe());
  el.replaceChildren(icon(ic, 18), h('span', { class: 'label' }, label));
}

async function onSyncStatusClick() {
  const st = sync.status.state;
  if (st === 'local') return openSettings('storage');
  if (st === 'error') toast(sync.status.message || 'Synkronointi epäonnistui', { kind: 'error' });
  const res = await sync.sync({ interactive: true });
  await afterSync(res);
  if (sync.status.state === 'ok') toast('Synkronoitu');
}

// ── Levyn tiedot ────────────────────────────────────────────────────────────
function valueNode(f, v) {
  if (f.type === 'textarea') return h('dd', { class: 'notes-dd' }, v);
  const dd = h('dd');
  renderValue(dd, f, v);
  if (f.type === 'grade') {
    const g = GRADES.find((x) => x.code === v);
    if (g) dd.append(` ${g.name}`);
  }
  return dd;
}

async function openDetail(id) {
  const r = state.records.find((x) => x.id === id);
  if (!r) return;
  const cover = await db.getCover(id);
  const fullUrl = cover?.full ? URL.createObjectURL(cover.full) : null;
  const F = fields();

  // Kentät ryhmittäin; artisti ja nimi ovat otsikossa
  const groups = new Map();
  for (const f of visibleFields()) {
    const v = r[f.key];
    if (!v || f.key === 'artist' || f.key === 'title') continue;
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push(h('div', { class: 'kv' }, h('dt', {}, f.label), valueNode(f, v)));
  }
  const extras = Object.entries(r).filter(([k, v]) => v && !SYSTEM_FIELDS.includes(k) && !F.has(k));
  if (extras.length) {
    groups.set('Muut sarakkeet', extras.map(([k, v]) => h('div', { class: 'kv' }, h('dt', {}, k), h('dd', {}, v))));
  }

  const sub = ['year', 'country', 'genre', 'style'].filter((k) => F.has(k) && r[k]).map((k) => formatValue(F.get(k), r[k])).join(' · ');
  const discogsUrl = r.discogs_id
    ? `https://www.discogs.com/release/${encodeURIComponent(r.discogs_id)}`
    : `https://www.discogs.com/search/?${new URLSearchParams({ q: `${r.artist} ${r.title}`, type: 'release' })}`;

  const d = openDialog({
    title: '',
    wide: true,
    className: 'detail',
    body: h('div', { class: 'detail-grid' },
      h('div', { class: 'detail-cover-wrap' },
        fullUrl ? h('img', { class: 'detail-cover', src: fullUrl, alt: `Kansikuva: ${r.artist} – ${r.title}` }) : h('div', { class: 'detail-cover' }, placeholderCover(r)),
        badgeFor(r)),
      h('div', { class: 'detail-info' },
        h('p', { class: 'detail-artist' }, r.artist),
        h('h3', { class: 'detail-title' }, r.title),
        sub && h('p', { class: 'detail-sub' }, sub),
        [...groups].map(([g, rows]) => h('section', { class: 'detail-group' }, h('h4', {}, g), h('dl', {}, rows))),
        h('p', { class: 'detail-links' },
          h('a', { href: discogsUrl, target: '_blank', rel: 'noopener' }, r.discogs_id ? 'Avaa Discogsissa ↗' : 'Etsi Discogsista ↗')),
        h('p', { class: 'stamp' }, `Lisätty ${formatDate(r.created_at)} · muokattu ${formatDate(r.updated_at)}`))),
    actions: [
      h('button', { class: 'btn btn-danger-text', onclick: () => { d.close(); deleteRecord(r.id); } }, icon('trash'), 'Poista'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-primary', onclick: () => { d.close(); openEditor(r.id); } }, icon('edit'), 'Muokkaa'),
    ],
    onClose: () => fullUrl && URL.revokeObjectURL(fullUrl),
  });
}

// ── Lomake ──────────────────────────────────────────────────────────────────
function fieldInput(f, value) {
  const common = { name: f.key, id: `f-${f.key}`, 'aria-describedby': `err-${f.key}`, required: f.required };
  const opts = (list) => list.map(([v, text]) => h('option', { value: v, selected: v === value }, text));
  switch (f.type) {
    case 'textarea': { const t = h('textarea', { ...common, rows: 3 }); t.value = value; return t; }
    case 'select': {
      const list = f.options.map((o) => [o, o]);
      if (value && !f.options.includes(value)) list.push([value, value]);
      return h('select', common, h('option', { value: '' }, '–'), opts(list));
    }
    case 'grade': {
      const list = GRADES.map((g) => [g.code, `${g.code} – ${g.name}: ${g.desc}`]);
      if (value && !GRADES.some((g) => g.code === value)) list.push([value, value]);
      return h('select', common, h('option', { value: '' }, '–'), opts(list));
    }
    case 'rating':
      return h('select', common, h('option', { value: '' }, '–'), opts([1, 2, 3, 4, 5].map((n) => [String(n), '★'.repeat(n) + '☆'.repeat(5 - n)])));
    case 'checkbox':
      return h('input', { ...common, type: 'checkbox', checked: !!value, class: 'check' });
    case 'date':
      return h('input', { ...common, type: 'date', value });
    case 'number':
      return h('input', { ...common, type: 'text', inputmode: f.decimals === 0 ? 'numeric' : 'decimal', value: editableText(f, value), placeholder: f.placeholder, autocomplete: 'off' });
    case 'money':
      return h('input', { ...common, type: 'text', inputmode: 'decimal', value: editableText(f, value), placeholder: f.placeholder || '0,00', autocomplete: 'off' });
    case 'url':
      return h('input', { ...common, type: 'url', inputmode: 'url', value, placeholder: f.placeholder || 'https://', autocomplete: 'off' });
    default:
      return h('input', { ...common, type: 'text', value, list: `dl-${f.key}`, placeholder: f.placeholder, autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'next' });
  }
}

async function openEditor(id = null) {
  const existing = id ? state.records.find((r) => r.id === id) : null;
  const rec = existing ? { ...existing } : emptyRecord(state.schema);
  const cover = { action: 'none', blob: null };
  const oldCover = existing ? await db.getCover(existing.id) : null;
  let previewUrl = oldCover?.thumb ? URL.createObjectURL(oldCover.thumb) : null;

  const preview = h('div', { class: 'cover-preview' });
  const coverActions = h('div', { class: 'cover-actions' });

  function renderCover() {
    preview.replaceChildren(previewUrl
      ? h('img', { src: previewUrl, alt: 'Kansikuvan esikatselu' })
      : h('div', { class: 'cover-empty' }, icon('image', 32), h('span', {}, 'Ei kansikuvaa')));
    coverActions.replaceChildren(
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => chooseImage('environment') }, icon('camera'), 'Ota kuva'),
      h('button', { type: 'button', class: 'btn', onclick: () => chooseImage() }, icon('image'), 'Galleriasta'),
      previewUrl ? h('button', { type: 'button', class: 'btn btn-danger-text', onclick: removeImage }, icon('trash'), 'Poista kuva') : '',
    );
  }

  async function useImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const blob = await openCropper(file);
      if (!blob) return;
      cover.action = 'set'; cover.blob = blob;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      renderCover();
    } catch (e) {
      console.error(e);
      toast('Kuvaa ei voitu avata. Kokeile JPEG- tai PNG-kuvaa.', { kind: 'error' });
    }
  }
  async function chooseImage(capture) { await useImage(await pickFile('image/*', { capture })); }
  function removeImage() {
    cover.action = 'remove'; cover.blob = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null; renderCover();
  }
  renderCover();

  preview.addEventListener('dragover', (e) => { e.preventDefault(); preview.classList.add('drop'); });
  preview.addEventListener('dragleave', () => preview.classList.remove('drop'));
  preview.addEventListener('drop', (e) => { e.preventDefault(); preview.classList.remove('drop'); useImage(e.dataTransfer.files[0]); });

  // Kentät ryhmittäin määrittelyn järjestyksessä
  const groups = new Map();
  for (const f of visibleFields()) {
    if (!groups.has(f.group)) groups.set(f.group, []);
    const wide = f.type === 'textarea' || f.key === 'artist' || f.key === 'title' || f.type === 'grade';
    groups.get(f.group).push(h('label', { class: `field t-${f.type}${wide ? ' wide' : ''}${f.required ? ' req' : ''}` },
      h('span', {}, f.label),
      fieldInput(f, rec[f.key] ?? ''),
      f.help && h('small', { class: 'help' }, f.help),
      h('small', { class: 'err', id: `err-${f.key}` })));
  }
  const datalists = visibleFields().filter((f) => f.type === 'text')
    .map((f) => h('datalist', { id: `dl-${f.key}` }, uniqueValues(f.key).slice(0, 300).map((v) => h('option', { value: v }))));

  const form = h('form', { class: 'editor', novalidate: true, autocomplete: 'off', id: 'editor-form' },
    h('section', { class: 'cover-edit' }, preview, coverActions,
      h('p', { class: 'hint desktop-only' }, 'Voit myös raahata kuvan tähän tai liittää sen leikepöydältä (Ctrl+V).')),
    h('div', { class: 'editor-fields' },
      [...groups].map(([g, items]) => h('fieldset', {}, h('legend', {}, g), items))),
    datalists);

  const onPaste = (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); useImage(file); }
  };
  document.addEventListener('paste', onPaste);

  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit', form: 'editor-form' }, icon('check'), 'Tallenna');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {};
    for (const f of visibleFields()) {
      const el = form.elements[f.key];
      if (el) data[f.key] = f.type === 'checkbox' ? (el.checked ? CHECKED : '') : el.value;
    }
    const next = normalizeRecord(state.schema, { ...rec, ...data });
    next.id = rec.id || newId();
    next.created_at = rec.created_at || nowIso();
    next.cover_file = rec.cover_file || '';
    const errors = validateRecord(state.schema, next);
    form.querySelectorAll('.err').forEach((el) => { el.textContent = ''; });
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    if (Object.keys(errors).length) {
      for (const [k, msg] of Object.entries(errors)) {
        const el = form.querySelector(`#err-${k}`);
        if (el) el.textContent = msg;
        form.elements[k]?.setAttribute('aria-invalid', 'true');
      }
      form.querySelector('[aria-invalid]')?.focus();
      return;
    }
    const dup = state.records.find((r) => r.id !== next.id && duplicateKey(r) === duplicateKey(next));
    if (dup && !(await confirmDialog(`Kokoelmassa on jo ${dup.artist} – ${dup.title}${dup.catalog_number ? ` (${dup.catalog_number})` : ''}. Tallennetaanko silti toisena kappaleena?`, { title: 'Mahdollinen tupla', ok: 'Tallenna' }))) return;
    saveBtn.disabled = true;
    try {
      await persistRecord(next, cover, existing);
      d.close();
      toast(existing ? 'Muutokset tallennettu' : `${next.title} lisätty kokoelmaan`);
    } catch (err) {
      console.error(err);
      toast(`Tallennus epäonnistui: ${err.message}`, { kind: 'error' });
      saveBtn.disabled = false;
    }
  });

  const d = openDialog({
    title: existing ? 'Muokkaa levyä' : 'Uusi levy',
    wide: true,
    className: 'editor-dialog',
    body: form,
    actions: [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Peruuta'), saveBtn],
    onClose: () => { document.removeEventListener('paste', onPaste); if (previewUrl) URL.revokeObjectURL(previewUrl); },
  });
  if (!existing && !matchMedia('(pointer: coarse)').matches) form.elements.artist?.focus();
}

async function persistRecord(rec, cover, existing) {
  if (cover.action === 'set') {
    const file = coverPath(rec.id, await shortHash(cover.blob));
    const thumb = await makeThumb(cover.blob);
    await db.putCover({ id: rec.id, file, full: cover.blob, thumb, synced: {} });
    if (existing?.cover_file && existing.cover_file !== file) await sync.queueRemoteDelete(existing.cover_file);
    rec.cover_file = file;
    if (state.thumbs.has(rec.id)) URL.revokeObjectURL(state.thumbs.get(rec.id));
    state.thumbs.set(rec.id, URL.createObjectURL(thumb));
  } else if (cover.action === 'remove') {
    await db.deleteCover(rec.id);
    if (existing?.cover_file) await sync.queueRemoteDelete(existing.cover_file);
    rec.cover_file = '';
    if (state.thumbs.has(rec.id)) { URL.revokeObjectURL(state.thumbs.get(rec.id)); state.thumbs.delete(rec.id); }
  }
  rec.updated_at = nowIso();
  await db.putRecords([rec]);
  const i = state.records.findIndex((r) => r.id === rec.id);
  if (i >= 0) state.records[i] = rec; else state.records.push(rec);
  if (state.frozenIds && !state.frozenIds.includes(rec.id)) state.frozenIds = null;
  render();
  scheduleSync();
}

async function deleteRecord(id) {
  const r = state.records.find((x) => x.id === id);
  if (!r) return;
  const cover = await db.getCover(id);
  await db.deleteRecords([id]);
  state.records = state.records.filter((x) => x.id !== id);
  const thumb = state.thumbs.get(id);
  state.thumbs.delete(id);
  render();

  let undone = false;
  const finalize = setTimeout(async () => {
    if (undone) return;
    if (thumb) URL.revokeObjectURL(thumb);
    if (r.cover_file) await sync.queueRemoteDelete(r.cover_file);
    scheduleSync();
  }, 5000);
  toast(`${r.title} poistettu`, {
    action: 'Kumoa',
    timeout: 5000,
    onAction: async () => {
      undone = true; clearTimeout(finalize);
      await db.putRecords([r]);
      if (cover) await db.putCover(cover);
      state.records.push(r);
      if (thumb) state.thumbs.set(id, thumb);
      render();
    },
  });
}

// ── Tuonti ja vienti ────────────────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10);

async function exportData(kind) {
  try {
    if (kind === 'zip') {
      const enc = new TextEncoder();
      const covers = await db.allCovers();
      const used = new Set(state.records.map((r) => r.cover_file));
      const files = [
        { name: CSV_NAME, data: enc.encode(recordsToCSV(state.records, state.schema)) },
        { name: SCHEMA_FILE, data: enc.encode(schemaToJSON(state.schema)) },
      ];
      for (const c of covers) {
        if (c.full && used.has(c.file)) files.push({ name: c.file, data: new Uint8Array(await c.full.arrayBuffer()) });
      }
      await saveFile(new Blob([createZip(files)], { type: 'application/zip' }), `lp-kokoelma-${today()}.zip`);
      await saveSettings({ lastExportAt: nowIso() });
      renderBanner();
      return;
    }
    const view = kind === 'csv-view';
    const records = view ? visibleRecords() : sortRecords(state.records, state.schema, []);
    if (kind === 'csv') {
      await saveFile(new Blob([recordsToCSV(records, state.schema)], { type: 'text/csv;charset=utf-8' }), `lp-kokoelma-${today()}.csv`);
      return;
    }
    // Excel: puolipiste-erotin, desimaalipilkku ja kenttien näkyvät nimet otsikoina
    const F = fields();
    const cols = view ? tableColumns().map((c) => c.field.key) : csvColumns(state.schema, records);
    const headers = cols.map((k) => F.get(k)?.label ?? k);
    const rows = records.map((r) => Object.fromEntries(cols.map((k, i) => [headers[i], F.has(k) ? editableText(F.get(k), r[k] ?? '') : r[k] ?? ''])));
    const csv = toCSV(headers, rows, { delimiter: ';' });
    await saveFile(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `lp-kokoelma-${view ? 'nakyma-' : ''}${today()}.csv`);
  } catch (e) {
    console.error(e);
    toast(`Vienti epäonnistui: ${e.message}`, { kind: 'error' });
  }
}

async function openExport() {
  const n = visibleRecords().length;
  const kind = await choiceDialog('Valitse muoto:', [
    { value: 'zip', label: 'Varmuuskopio (ZIP)', desc: 'CSV, kentät ja kaikki kansikuvat. Tällä voi palauttaa koko kokoelman.' },
    { value: 'csv-excel', label: 'Excel (CSV)', desc: 'Puolipiste-erotin ja suomenkieliset sarakenimet – aukeaa suoraan Excelissä.' },
    n !== state.records.length || state.settings.view === 'table'
      ? { value: 'csv-view', label: `Nykyinen näkymä Exceliin (${n} riviä)`, desc: 'Vain suodatetut rivit ja näkyvät sarakkeet nykyisessä järjestyksessä.' }
      : null,
    { value: 'csv', label: 'CSV (standardi)', desc: 'Sama muoto kuin kokoelma.csv – Google Sheets, Numbers, muut ohjelmat.' },
  ].filter(Boolean), { title: 'Vie kokoelma' });
  if (kind) exportData(kind);
}

function importDialog({ total, imgCount, fresh, updates, dupes, newFields }) {
  return new Promise((resolve) => {
    let result = null;
    let mode = 'merge';
    const radio = (value, title, desc, danger = false) => h('label', { class: `choice radio${danger ? ' danger' : ''}` },
      h('input', { type: 'radio', name: 'import-mode', value, checked: value === mode, onchange: () => { mode = value; } }),
      h('span', {}, h('strong', {}, title), h('span', {}, desc)));
    const addNew = h('input', { type: 'checkbox', checked: true });
    const d = openDialog({
      title: 'Tuo levyt',
      className: 'small',
      body: h('div', { class: 'import-dlg' },
        h('p', { class: 'confirm-text' }, `Tiedostossa on ${total} levyä${imgCount ? ` ja ${imgCount} kansikuvaa` : ''}.`),
        h('div', { class: 'choice-list' },
          radio('merge', 'Yhdistä kokoelmaan', `${fresh} uutta, ${updates} päivitettyä${dupes ? `, ${dupes} tuplaa ohitetaan` : ''}.`),
          radio('replace', 'Korvaa koko kokoelma', `Nykyiset ${state.records.length} levyä poistetaan.`, true)),
        newFields.length ? h('label', { class: 'fe-flag import-new' }, addNew,
          h('span', {}, `Lisää tuntemattomat sarakkeet uusiksi kentiksi: ${newFields.map((f) => f.label).join(', ')}`)) : ''),
      actions: [
        h('button', { class: 'btn', onclick: () => d.close() }, 'Peruuta'),
        h('button', { class: 'btn btn-primary', onclick: () => { result = { mode, addNew: newFields.length > 0 && addNew.checked }; d.close(); } }, 'Tuo'),
      ],
      onClose: () => resolve(result),
    });
  });
}

async function importFile() {
  const file = await pickFile('.csv,.zip,.txt,text/csv,application/zip');
  if (!file) return;
  try {
    let csvText;
    let images = new Map();
    let zipSchema = null;
    if (/\.zip$/i.test(file.name) || file.type.includes('zip')) {
      const entries = await readZip(new Uint8Array(await file.arrayBuffer()));
      const csvName = entries.has(CSV_NAME) ? CSV_NAME : [...entries.keys()].find((n) => /\.csv$/i.test(n));
      if (!csvName) throw new Error('ZIP-paketista ei löytynyt CSV-tiedostoa');
      csvText = new TextDecoder().decode(entries.get(csvName));
      if (entries.has(SCHEMA_FILE)) {
        try { zipSchema = parseSchema(new TextDecoder().decode(entries.get(SCHEMA_FILE))).schema; } catch { /* ohitetaan */ }
      }
      images = entries;
    } else {
      csvText = await file.text();
    }
    const { headers, records: rows } = parseCSVObjects(csvText);

    // Uudet kentät: varmuuskopion kentat.json ja tuntemattomat sarakkeet
    const headerSet = new Set(headers.map((x) => x.trim()));
    const zipExtra = zipSchema ? mergeSchemas(state.schema, zipSchema).added.filter((f) => headerSet.has(f.key)) : [];
    const withZip = { ...state.schema, fields: [...state.schema.fields, ...zipExtra] };
    const newFields = [...zipExtra, ...fieldsForHeaders(withZip, mapHeaders(withZip, headers).unknown)];
    const extended = { ...state.schema, fields: [...state.schema.fields, ...newFields] };

    const parse = (schema) => {
      const { mapping } = mapHeaders(schema, headers);
      return rows.map((row) => fromImportRow(schema, row, mapping)).filter(Boolean);
    };
    const classify = (incoming) => {
      const byId = new Map(state.records.map((r) => [r.id, r]));
      const keys = new Set(state.records.map(duplicateKey));
      return {
        fresh: incoming.filter((r) => !byId.has(r.id) && !keys.has(duplicateKey(r))),
        updates: incoming.filter((r) => byId.has(r.id) && r.updated_at > byId.get(r.id).updated_at),
        dupes: incoming.filter((r) => !byId.has(r.id) && keys.has(duplicateKey(r))),
      };
    };

    const preview = parse(extended);
    if (!preview.length) throw new Error('Tiedostosta ei löytynyt levyjä. Tarvitaan vähintään sarakkeet artisti ja levyn nimi (tai artist ja title).');
    const pc = classify(preview);
    const choice = await importDialog({
      total: preview.length,
      imgCount: preview.filter((r) => r.cover_file && images.has(r.cover_file)).length,
      fresh: pc.fresh.length, updates: pc.updates.length, dupes: pc.dupes.length, newFields,
    });
    if (!choice) return;
    if (choice.mode === 'replace' && state.records.length &&
      !(await confirmDialog(`Poistetaanko nykyiset ${state.records.length} levyä ja korvataan ne tuoduilla?`, { title: 'Korvaa kokoelma', ok: 'Korvaa', danger: true }))) return;

    if (choice.addNew) await applySchema({ ...extended, updated_at: nowIso() }, { sync: false });
    const incoming = parse(choice.addNew ? extended : state.schema);
    const c = classify(incoming);
    const toWrite = choice.mode === 'replace' ? incoming : [...c.fresh, ...c.updates];
    if (choice.mode === 'replace') {
      const keep = new Set(incoming.map((r) => r.id));
      const removed = state.records.filter((r) => !keep.has(r.id));
      for (const r of removed) if (r.cover_file) await sync.queueRemoteDelete(r.cover_file);
      await db.deleteRecords(removed.map((r) => r.id));
    }
    for (const r of toWrite) {
      if (r.cover_file && images.has(r.cover_file)) {
        const full = new Blob([images.get(r.cover_file)], { type: 'image/jpeg' });
        await db.putCover({ id: r.id, file: r.cover_file, full, thumb: await makeThumb(full), synced: {} });
      } else if (r.cover_file && state.settings.backend === 'local' && !(await db.getCover(r.id))) {
        r.cover_file = '';
      }
    }
    await db.putRecords(toWrite);
    await loadAll();
    state.frozenIds = null;
    render();
    scheduleSync();
    toast(`Tuotu ${toWrite.length} levyä${choice.addNew ? ` ja ${newFields.length} uutta kenttää` : ''}`);
  } catch (e) {
    console.error(e);
    toast(`Tuonti epäonnistui: ${e.message}`, { kind: 'error', timeout: 8000 });
  }
}

// ── Tilastot ────────────────────────────────────────────────────────────────
function openStats() {
  const recs = visibleRecords();
  const s = computeStats(state.schema, recs);
  const filtered = recs.length !== state.records.length;
  const tile = (label, value) => h('div', { class: 'tile' }, h('div', { class: 'tile-value' }, value), h('div', { class: 'tile-label' }, label));
  const bars = ({ label, entries, all }) => {
    const max = Math.max(...entries.map((e) => e[1]));
    return h('section', { class: 'bars' }, h('h3', {}, label),
      entries.slice(0, all ? 30 : 12).map(([k, v]) => h('div', { class: 'bar-row' },
        h('span', { class: 'bar-label' }, k),
        h('span', { class: 'bar-track' }, h('span', { class: 'bar', style: { width: `${(v / max) * 100}%` } })),
        h('span', { class: 'bar-value' }, v))));
  };
  openDialog({
    title: filtered ? `Tilastot – ${recs.length} suodatettua levyä` : 'Tilastot',
    wide: true,
    body: h('div', { class: 'stats' },
      h('div', { class: 'tiles' },
        tile('levyä', s.total), tile('vinyyliä', s.discs), tile('artistia', s.artists),
        s.money.map((m) => tile(`${m.label.toLowerCase()} yhteensä`, formatMoney(m.value))),
        tile('kansikuvaa', `${s.withCover}/${s.total}`)),
      h('div', { class: 'bars-grid' }, s.distributions.map(bars))),
  });
}

// ── Teemavalitsin ───────────────────────────────────────────────────────────
function swatch(t, current, onPick) {
  const v = themeVars(t);
  return h('button', {
    class: 'swatch', type: 'button', 'aria-pressed': String(current === t.id),
    style: { '--sw-bg': v['--bg'], '--sw-surface': v['--surface'], '--sw-text': v['--text'], '--sw-accent': v['--accent'], '--sw-radius': v['--radius'], '--sw-font': v['--font-display'] },
    onclick: () => onPick(t.id),
  },
  h('span', { class: 'sw-preview' }, h('span', { class: 'sw-card' }), h('span', { class: 'sw-card' }), h('span', { class: 'sw-dot' })),
  h('span', { class: 'sw-name' }, t.name));
}

function themePicker(onChange) {
  const wrap = h('div', { class: 'theme-picker' });
  const draw = () => {
    const cur = state.settings.theme;
    const pick = async (id) => { await saveSettings({ theme: id }); refreshTheme(); draw(); onChange?.(); };
    const auto = { ...resolveTheme({ theme: 'auto' }, darkQuery.matches), id: AUTO_THEME.id, name: 'Automaattinen' };
    const custom = customTheme(state.settings);
    const c = state.settings.customTheme;
    const setC = async (patch) => { await saveSettings({ customTheme: { ...c, ...patch }, theme: CUSTOM_ID }); refreshTheme(); draw(); };
    const color = (k, label) => h('label', { class: 'color-field' }, h('input', { type: 'color', value: c[k], onchange: (e) => setC({ [k]: e.target.value }) }), h('span', {}, label));
    wrap.replaceChildren(
      h('div', { class: 'swatches' }, swatch(auto, cur, pick), THEMES.map((t) => swatch(t, cur, pick)), swatch(custom, cur, pick)),
      h('details', { class: 'custom-theme', open: cur === CUSTOM_ID },
        h('summary', {}, 'Muokkaa omaa teemaa'),
        h('div', { class: 'custom-grid' },
          color('bg', 'Tausta'), color('text', 'Teksti'), color('accent', 'Korostus'),
          h('label', { class: 'field' }, h('span', {}, 'Pohja'),
            h('select', { onchange: (e) => setC({ scheme: e.target.value }) },
              h('option', { value: 'light', selected: c.scheme === 'light' }, 'Vaalea'),
              h('option', { value: 'dark', selected: c.scheme === 'dark' }, 'Tumma'))),
          h('label', { class: 'field' }, h('span', {}, 'Otsikkofontti'),
            h('select', { onchange: (e) => setC({ font: e.target.value }) },
              Object.entries(FONT_NAMES).map(([k, n]) => h('option', { value: k, selected: c.font === k }, n)))),
          h('label', { class: 'field' }, h('span', {}, 'Kulmat'),
            h('select', { onchange: (e) => setC({ radius: e.target.value }) },
              [['2px', 'Terävät'], ['8px', 'Pienet'], ['12px', 'Normaalit'], ['20px', 'Pyöreät']].map(([v, n]) => h('option', { value: v, selected: c.radius === v }, n))))),
        h('p', { class: 'hint' }, 'Vinkki: uusia valmisteemoja voi lisätä tiedostoon js/themes.js – katso README.')));
  };
  draw();
  return wrap;
}

function openThemes() {
  openDialog({ title: 'Teema', body: themePicker() });
}

// ── Asetukset ───────────────────────────────────────────────────────────────
async function changeBackend(id) {
  const s = state.settings;
  if (id === s.backend) return false;
  const target = getBackend(id, s);
  if (id === 'dropbox' && !s.dropboxAppKey) { toast('Anna ensin Dropboxin App key', { kind: 'error' }); return false; }
  if (id === 'gdrive' && !s.googleClientId) { toast('Anna ensin Googlen Client ID', { kind: 'error' }); return false; }
  const covers = state.thumbs.size;
  const msg = id === 'local'
    ? 'Kokoelma jää tälle laitteelle, mutta sitä ei enää synkronoida pilveen.'
    : `Kokoelma (${state.records.length} levyä, ${covers} kansikuvaa) ja kenttämäärittely kopioidaan paikkaan ${target.label}. Jos siellä on jo kokoelma, ne yhdistetään. Tämä laite pitää aina oman kopion, joten sovellus toimii myös ilman verkkoa.`;
  if (!(await confirmDialog(msg, { title: `Vaihda: ${target.label}`, ok: 'Vaihda' }))) return false;
  try {
    // Dropbox siirtää sivun kirjautumiseen; valinta viimeistellään paluun jälkeen (init)
    sessionStorage.setItem('pendingBackend', id);
    if (id !== 'local' && !(await target.connect(true))) return false;
    sessionStorage.removeItem('pendingBackend');
  } catch (e) {
    toast(e.message, { kind: 'error', timeout: 8000 });
    return false;
  }
  await saveSettings({ backend: id });
  sync.setBackend(target, s);
  const res = await sync.sync({ interactive: true });
  await afterSync(res);
  if (sync.status.state === 'ok') toast(`Tallennuspaikka vaihdettu: ${target.label}`);
  return true;
}

function openSettings(focus) {
  const body = h('div', { class: 'settings' });
  const draw = () => {
    const s = state.settings;
    const backend = currentBackend();
    const keyField = (k, label, ph, help) => h('label', { class: 'field wide' }, h('span', {}, label),
      h('input', { value: s[k] || '', placeholder: ph, autocomplete: 'off', spellcheck: false, autocapitalize: 'none', onchange: async (e) => { await saveSettings({ [k]: e.target.value.trim() }); currentBackend(); draw(); } }),
      help && h('small', { class: 'help' }, help));

    body.replaceChildren(
      h('section', { id: 'set-storage' },
        h('h3', {}, 'Tallennuspaikka'),
        h('p', { class: 'hint' }, 'Levyt tallennetaan tiedostoon kokoelma.csv, kentät tiedostoon kentat.json ja kansikuvat kansioon kannet/. Pilvessä sama kokoelma näkyy kaikilla laitteilla.'),
        h('div', { class: 'backend-list', role: 'radiogroup' },
          BACKENDS.filter((b) => b.supported()).map((b) => h('button', {
            type: 'button', role: 'radio', class: 'backend', 'aria-checked': String(s.backend === b.id),
            onclick: async () => { if (await changeBackend(b.id)) draw(); },
          }, icon({ local: 'disc', dropbox: 'cloud', gdrive: 'cloud', folder: 'download' }[b.id] || 'cloud'), h('span', {}, b.label)))),
        h('div', { class: 'backend-status' },
          h('span', { class: `dot ${sync.status.state}` }), h('span', {}, backend.describe()),
          s.backend !== 'local' && h('span', { class: 'spacer' }),
          s.backend !== 'local' && h('button', { class: 'btn btn-small', onclick: async () => { await afterSync(await sync.sync({ interactive: true })); draw(); } }, icon('sync', 16), 'Synkronoi nyt'),
          s.backend !== 'local' && h('button', { class: 'btn btn-small btn-text', onclick: async () => { await backend.disconnect(); sync.emit({ state: 'login' }); draw(); } }, 'Kirjaudu ulos')),
        h('details', { class: 'advanced', open: s.backend === 'dropbox' || s.backend === 'gdrive' || focus === 'storage' },
          h('summary', {}, 'Pilvipalveluiden avaimet'),
          keyField('dropboxAppKey', 'Dropbox App key', 'esim. a1b2c3d4e5f6g7h', 'dropbox.com/developers/apps → Create app → App folder. Ohje README:ssä.'),
          keyField('googleClientId', 'Google OAuth Client ID', '…apps.googleusercontent.com', 'console.cloud.google.com → Credentials → OAuth client ID (Web). Ohje README:ssä.'),
          keyField('remoteFolder', 'Kansion nimi pilvessä', 'LP-kokoelma'),
          h('p', { class: 'hint' }, `Paluuosoite, joka rekisteröidään palveluun: ${location.origin}${location.pathname}`))),
      h('section', { id: 'set-fields' },
        h('h3', {}, 'Kentät'),
        h('p', { class: 'hint' }, `${state.schema.fields.length} kenttää (${state.schema.fields.filter((f) => f.hidden).length} piilotettu). Määrittely: ${SCHEMA_FILE} – ${schemaLocationText()}. Tiedostoa voi muokata myös tekstieditorilla; muutos tulee käyttöön seuraavassa synkronoinnissa ilman sovelluspäivitystä.`),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', onclick: openFields }, icon('fields'), 'Muokkaa kenttiä'),
          h('button', { class: 'btn', onclick: exportSchema }, icon('download'), `Lataa ${SCHEMA_FILE}`),
          h('button', { class: 'btn', onclick: importSchema }, icon('upload'), `Tuo ${SCHEMA_FILE}`)),
        state.schemaWarnings.length ? h('div', { class: 'warnings' }, h('strong', {}, 'Huomautuksia kenttämäärittelystä:'),
          h('ul', {}, state.schemaWarnings.map((w) => h('li', {}, w)))) : ''),
      h('section', {}, h('h3', {}, 'Teema'), themePicker()),
      h('section', {},
        h('h3', {}, 'Tiedot'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', onclick: openExport }, icon('download'), 'Vie / varmuuskopioi'),
          h('button', { class: 'btn', onclick: importFile }, icon('upload'), 'Tuo CSV tai ZIP')),
        h('p', { class: 'hint', id: 'storage-usage' }, s.lastExportAt ? `Viimeisin varmuuskopio ${formatDate(s.lastExportAt)}.` : 'Varmuuskopiota ei ole vielä otettu.'),
        h('button', { class: 'btn btn-danger-text', onclick: wipeAll }, icon('trash'), 'Tyhjennä tämän laitteen tiedot')),
      h('section', { class: 'about' },
        h('p', {}, `Levyhylly ${VERSION} · Tiedot pysyvät omissa tiedostoissasi – sovellus ei lähetä niitä minnekään muualle.`)));

    navigator.storage?.estimate?.().then(({ usage }) => {
      const el = body.querySelector('#storage-usage');
      if (el && usage) el.textContent += ` Laitteella käytössä ${(usage / 1048576).toFixed(1)} Mt.`;
    });
  };
  draw();
  const prev = sync.onStatus;
  sync.onStatus = (st) => { prev(st); if (body.isConnected) draw(); };
  openDialog({ title: 'Asetukset', wide: true, body, onClose: () => { sync.onStatus = prev; } });
  if (focus) requestAnimationFrame(() => body.querySelector(`#set-${focus}`)?.scrollIntoView({ block: 'start' }));
}

async function wipeAll() {
  if (!(await confirmDialog('Kaikki levyt ja kansikuvat poistetaan tästä selaimesta. Pilveen tallennettuja tiedostoja ei poisteta. Ota varmuuskopio ensin!', { title: 'Tyhjennä laite', ok: 'Tyhjennä', danger: true }))) return;
  await db.deleteRecords(state.records.map((r) => r.id));
  await db.setMeta(`syncBase:${sync.key}`, {});
  await loadAll();
  render();
  toast('Tämän laitteen tiedot tyhjennetty');
}

// ── Käynnistys ─────────────────────────────────────────────────────────────
function bindChrome() {
  const search = $('#search');
  search.addEventListener('input', debounce(() => { state.query = search.value.trim(); state.frozenIds = null; render(); }, 150));
  $('#sort').addEventListener('change', (e) => {
    const key = e.target.value;
    const dir = key === 'created_at' || key === 'updated_at' ? 'desc' : 'asc';
    setSort(key ? [{ key, dir }] : []);
  });
  $('#sort-dir').addEventListener('click', () => {
    const [first, ...rest] = state.settings.sort;
    if (first) setSort([{ ...first, dir: first.dir === 'asc' ? 'desc' : 'asc' }, ...rest]);
  });
  $('#filter-toggle').addEventListener('click', openFilterPanel);
  $('#btn-columns').addEventListener('click', (e) => openColumns(e.currentTarget));
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', async () => {
    if (state.settings.view === b.dataset.view) return;
    state.frozenIds = null;
    await saveSettings({ view: b.dataset.view });
    window.scrollTo(0, 0);
    render();
    if (b.dataset.view === 'table') state.table?.el.focus({ preventScroll: true });
  }));
  $('#add').addEventListener('click', () => openEditor());
  $('#fab').addEventListener('click', () => openEditor());
  $('#btn-stats').addEventListener('click', openStats);
  $('#btn-theme').addEventListener('click', openThemes);
  $('#btn-settings').addEventListener('click', () => openSettings());
  $('#sync-status').addEventListener('click', onSyncStatusClick);

  // Pikanäppäimet läppärillä
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open], .popover')) return;
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !inField) {
      e.preventDefault();
      undoLast();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (inField) {
      if (e.key === 'Escape' && document.activeElement === search) { search.value = ''; state.query = ''; render(); search.blur(); }
      return;
    }
    if (document.activeElement === state.table?.el) return; // taulukko käsittelee omat näppäimensä
    if (e.key === '/') { e.preventDefault(); search.focus(); }
    if (e.key === 'n' || e.key === '+') { e.preventDefault(); openEditor(); }
  });

  window.addEventListener('online', () => sync.sync().then(afterSync));
  window.addEventListener('offline', () => sync.emit({ state: state.settings.backend === 'local' ? 'local' : 'offline' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync.sync().then(afterSync);
  });
}

async function init() {
  const saved = await db.getMeta('settings', {});
  state.settings = migrateSettings({
    ...structuredClone(DEFAULT_SETTINGS), ...saved,
    customTheme: { ...DEFAULT_SETTINGS.customTheme, ...saved.customTheme },
  });
  for (const k of ['dropboxAppKey', 'googleClientId']) if (!state.settings[k] && CONFIG[k]) state.settings[k] = CONFIG[k];
  refreshTheme();
  bindChrome();

  await loadSchema();
  await loadAll();
  render();
  document.body.classList.add('ready');

  sync.setBackend(currentBackend(), state.settings);
  try {
    dropboxBackend.configure(state.settings);
    if (await dropboxBackend.handleRedirect()) {
      if (sessionStorage.getItem('pendingBackend') === 'dropbox') {
        sessionStorage.removeItem('pendingBackend');
        await saveSettings({ backend: 'dropbox' });
        sync.setBackend(currentBackend(), state.settings);
      }
      toast('Dropbox yhdistetty – kokoelma synkronoidaan');
    }
  } catch (e) {
    toast(e.message, { kind: 'error', timeout: 8000 });
  }
  sync.sync().then(afterSync);
  requestPersistence();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Uusi versio saatavilla', {
              action: 'Päivitä', timeout: 15000,
              onAction: () => {
                navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
                w.postMessage('skipWaiting');
              },
            });
          }
        });
      });
    }).catch((e) => console.warn('Service worker -rekisteröinti epäonnistui', e));
  }
}

init().catch((e) => {
  console.error(e);
  document.body.classList.add('ready');
  $('#collection').replaceChildren(h('div', { class: 'empty-state' },
    h('h2', {}, 'Sovellusta ei voitu käynnistää'),
    h('p', {}, e.message),
    h('p', {}, 'Selaimen yksityinen tila voi estää tallennuksen. Kokeile tavallista ikkunaa.')));
});
