// LP-kokoelma – sovelluksen pääosa: tila, näkymät ja toiminnot.

import { db, requestPersistence } from './db.js';
import { CONFIG } from './config.js';
import {
  FIELDS, LABELS, FORMATS, SIZES, SPEEDS, GRADES, SORTS, emptyRecord, newId, nowIso,
  normalizeRecord, validateRecord, fromImportRow, duplicateKey, matchesQuery, computeStats,
} from './model.js';
import { parseCSVObjects, toCSV } from './csv.js';
import { createZip, readZip } from './zip.js';
import { makeThumb, shortHash, coverPath } from './image.js';
import { openCropper } from './cropper.js';
import { SyncEngine, recordsToCSV, CSV_NAME } from './sync.js';
import { BACKENDS, getBackend } from './backends/index.js';
import { dropboxBackend } from './backends/dropbox.js';
import {
  THEMES, AUTO_THEME, CUSTOM_ID, FONT_NAMES, resolveTheme, applyTheme, customTheme, themeVars,
} from './themes.js';
import {
  h, icon, toast, openDialog, confirmDialog, choiceDialog, debounce, formatDate, formatMoney, saveFile, pickFile,
} from './ui.js';

const VERSION = '1.0.0';

// ── Tila ───────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  backend: 'local',
  dropboxAppKey: CONFIG.dropboxAppKey,
  googleClientId: CONFIG.googleClientId,
  remoteFolder: CONFIG.remoteFolder,
  theme: 'auto',
  customTheme: { scheme: 'light', bg: '#faf7f2', text: '#1d1c1a', accent: '#7c3aed', font: 'sans', radius: '12px' },
  view: 'grid',
  sort: 'artist',
  lastExportAt: null,
};

const state = {
  settings: { ...DEFAULT_SETTINGS },
  records: [],
  thumbs: new Map(), // id → object URL
  query: '',
  filters: { genre: '', format: '', grade: '' },
};

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const $ = (sel) => document.querySelector(sel);

const sync = new SyncEngine({ store: db, makeThumb, onStatus: renderSyncStatus });
const scheduleSync = debounce(() => sync.sync().then(afterSync), 2500);

async function saveSettings(patch) {
  Object.assign(state.settings, patch);
  await db.setMeta('settings', state.settings);
}

function currentBackend() {
  return getBackend(state.settings.backend, state.settings);
}

// ── Teema ──────────────────────────────────────────────────────────────────
function refreshTheme() {
  applyTheme(resolveTheme(state.settings, darkQuery.matches));
}
darkQuery.addEventListener('change', refreshTheme);

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
  if (result?.changed) { await loadAll(); render(); }
}

// ── Päänäkymä ───────────────────────────────────────────────────────────────
function visibleRecords() {
  const { genre, format, grade } = state.filters;
  return state.records
    .filter((r) => (!genre || r.genre === genre) && (!format || r.format === format) &&
      (!grade || r.media_grade === grade) && matchesQuery(r, state.query))
    .sort(SORTS[state.settings.sort]?.cmp ?? SORTS.artist.cmp);
}

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

function card(r) {
  const meta = [r.year, r.format !== 'LP' ? r.format : '', r.media_grade].filter(Boolean).join(' · ');
  return h('button', { class: 'card', onclick: () => openDetail(r.id), 'aria-label': `${r.artist}: ${r.title}` },
    coverEl(r),
    h('div', { class: 'card-text' },
      h('div', { class: 'card-title' }, r.title),
      h('div', { class: 'card-artist' }, r.artist),
      meta && h('div', { class: 'card-meta' }, meta)));
}

function row(r) {
  return h('button', { class: 'row', onclick: () => openDetail(r.id) },
    coverEl(r, 'small'),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, r.title),
      h('div', { class: 'row-artist' }, r.artist)),
    h('div', { class: 'row-col col-year' }, r.year),
    h('div', { class: 'row-col col-label' }, [r.label, r.catalog_number].filter(Boolean).join(' · ')),
    h('div', { class: 'row-col col-genre' }, r.genre),
    h('div', { class: 'row-col col-loc' }, r.location),
    h('div', { class: 'row-col col-grade' }, r.media_grade && h('span', { class: 'grade' }, r.media_grade)));
}

function fillSelect(sel, values, allLabel) {
  const current = sel.value;
  sel.replaceChildren(h('option', { value: '' }, allLabel), ...values.map((v) => h('option', { value: v }, v)));
  sel.value = values.includes(current) ? current : '';
}

function uniqueValues(field) {
  return [...new Set(state.records.map((r) => r[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fi'));
}

function render() {
  const list = visibleRecords();
  const main = $('#collection');
  const total = state.records.length;

  $('#count').textContent = total
    ? (list.length === total ? `${total} levyä` : `${list.length} / ${total} levyä`)
    : '';

  fillSelect($('#f-genre'), uniqueValues('genre'), 'Kaikki genret');
  fillSelect($('#f-format'), FORMATS.filter((f) => state.records.some((r) => r.format === f)), 'Kaikki formaatit');
  fillSelect($('#f-grade'), GRADES.map((g) => g.code).filter((c) => state.records.some((r) => r.media_grade === c)), 'Kaikki kunnot');
  for (const k of ['genre', 'format', 'grade']) $(`#f-${k}`).value = state.filters[k];
  const activeFilters = Object.values(state.filters).filter(Boolean).length;
  $('#filter-toggle').dataset.count = activeFilters || '';

  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.settings.view)));

  main.className = state.settings.view === 'list' ? 'list' : 'grid';
  if (!total) {
    main.className = 'empty';
    main.replaceChildren(h('div', { class: 'empty-state' },
      h('div', { class: 'empty-disc' }),
      h('h2', {}, 'Hylly on vielä tyhjä'),
      h('p', {}, 'Lisää ensimmäinen levy ja ota kannesta kuva – tai tuo olemassa oleva luettelo CSV-tiedostosta (myös Discogsin vienti käy).'),
      h('div', { class: 'empty-actions' },
        h('button', { class: 'btn btn-primary', onclick: () => openEditor() }, icon('plus'), 'Lisää levy'),
        h('button', { class: 'btn', onclick: importFile }, icon('upload'), 'Tuo tiedosto'),
        state.settings.backend === 'local' && h('button', { class: 'btn', onclick: () => openSettings('storage') }, icon('cloud'), 'Yhdistä pilveen'))));
    renderBanner();
    return;
  }
  if (!list.length) {
    main.className = 'empty';
    main.replaceChildren(h('div', { class: 'empty-state small' },
      h('p', {}, 'Haulla ei löytynyt levyjä.'),
      h('button', { class: 'btn', onclick: clearFilters }, 'Tyhjennä haku ja suodattimet')));
    renderBanner();
    return;
  }
  if (state.settings.view === 'list') {
    main.replaceChildren(
      h('div', { class: 'row head', 'aria-hidden': 'true' },
        h('span', {}), h('span', {}, 'Levy'), h('span', { class: 'col-year' }, 'Vuosi'),
        h('span', { class: 'col-label' }, 'Yhtiö'), h('span', { class: 'col-genre' }, 'Genre'),
        h('span', { class: 'col-loc' }, 'Sijainti'), h('span', { class: 'col-grade' }, 'Kunto')),
      ...list.map(row));
  } else {
    main.replaceChildren(...list.map(card));
  }
  renderBanner();
}

function clearFilters() {
  state.query = ''; $('#search').value = '';
  state.filters = { genre: '', format: '', grade: '' };
  render();
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
async function openDetail(id) {
  const r = state.records.find((x) => x.id === id);
  if (!r) return;
  const cover = await db.getCover(id);
  const fullUrl = cover?.full ? URL.createObjectURL(cover.full) : null;

  const field = (k, v = r[k]) => v ? h('div', { class: 'kv' }, h('dt', {}, LABELS[k]), h('dd', {}, v)) : null;
  const grade = (k) => {
    const g = GRADES.find((x) => x.code === r[k]);
    return g ? h('div', { class: 'kv' }, h('dt', {}, LABELS[k]), h('dd', {}, h('span', { class: 'grade' }, g.code), ` ${g.name}`)) : null;
  };
  const fmt = [r.discs > 1 ? `${r.discs} × ` : '', r.format, r.size, r.speed_rpm && `${r.speed_rpm} rpm`].filter(Boolean).join(' ').replace('×  ', '× ');
  const discogsUrl = r.discogs_id
    ? `https://www.discogs.com/release/${encodeURIComponent(r.discogs_id)}`
    : `https://www.discogs.com/search/?${new URLSearchParams({ q: `${r.artist} ${r.title}`, type: 'release' })}`;

  const d = openDialog({
    title: '',
    wide: true,
    className: 'detail',
    body: h('div', { class: 'detail-grid' },
      fullUrl ? h('img', { class: 'detail-cover', src: fullUrl, alt: `Kansikuva: ${r.artist} – ${r.title}` }) : h('div', { class: 'detail-cover' }, placeholderCover(r)),
      h('div', { class: 'detail-info' },
        h('p', { class: 'detail-artist' }, r.artist),
        h('h3', { class: 'detail-title' }, r.title),
        h('p', { class: 'detail-sub' }, [r.year, r.country, r.genre, r.style].filter(Boolean).join(' · ')),
        h('dl', {},
          field('label'), field('catalog_number'), fmt && h('div', { class: 'kv' }, h('dt', {}, LABELS.format), h('dd', {}, fmt)),
          grade('media_grade'), grade('sleeve_grade'), field('location'),
          field('purchase_date', r.purchase_date && new Date(r.purchase_date).toLocaleDateString('fi-FI')),
          field('purchase_price', r.purchase_price && formatMoney(Number(r.purchase_price))),
          field('purchase_place'), field('barcode')),
        r.notes && h('div', { class: 'notes' }, r.notes),
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
async function openEditor(id = null) {
  const existing = id ? state.records.find((r) => r.id === id) : null;
  const rec = existing ? { ...existing } : emptyRecord();
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
      previewUrl && h('button', { type: 'button', class: 'btn btn-danger-text', onclick: removeImage }, icon('trash'), 'Poista kuva'),
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

  // Raahaa ja pudota / liitä leikepöydältä (läppäri)
  preview.addEventListener('dragover', (e) => { e.preventDefault(); preview.classList.add('drop'); });
  preview.addEventListener('dragleave', () => preview.classList.remove('drop'));
  preview.addEventListener('drop', (e) => { e.preventDefault(); preview.classList.remove('drop'); useImage(e.dataTransfer.files[0]); });

  const datalist = (fid, values) => h('datalist', { id: fid }, values.map((v) => h('option', { value: v })));
  const input = (k, opts = {}) => h('label', { class: `field ${opts.wide ? 'wide' : ''} ${opts.req ? 'req' : ''}` },
    h('span', {}, LABELS[k]),
    h('input', {
      name: k, value: rec[k] ?? '', type: opts.type || 'text', inputmode: opts.inputmode, list: opts.list,
      autocomplete: 'off', autocapitalize: opts.caps ?? 'words', enterkeyhint: 'next', placeholder: opts.ph,
      required: opts.req, step: opts.step, min: opts.min, max: opts.max,
    }),
    h('small', { class: 'err', id: `err-${k}` }));
  const select = (k, options, opts = {}) => h('label', { class: `field ${opts.wide ? 'wide' : ''}` },
    h('span', {}, LABELS[k]),
    h('select', { name: k },
      opts.empty !== false && h('option', { value: '' }, '–'),
      options.map((o) => h('option', { value: o.value ?? o, selected: (o.value ?? o) === rec[k] }, o.label ?? o))),
    h('small', { class: 'err', id: `err-${k}` }));
  const gradeOptions = GRADES.map((g) => ({ value: g.code, label: `${g.code} – ${g.name}: ${g.desc}` }));

  const form = h('form', { class: 'editor', novalidate: true, autocomplete: 'off' },
    h('section', { class: 'cover-edit' }, preview, coverActions,
      h('p', { class: 'hint desktop-only' }, 'Voit myös raahata kuvan tähän tai liittää sen leikepöydältä (Ctrl+V).')),
    h('fieldset', {}, h('legend', {}, 'Perustiedot'),
      input('artist', { req: true, list: 'dl-artist', wide: true }),
      input('title', { req: true, wide: true, caps: 'sentences' }),
      input('year', { type: 'number', inputmode: 'numeric', min: 1890, max: new Date().getFullYear() + 1, ph: 'esim. 1973' }),
      input('label', { list: 'dl-label' }),
      input('catalog_number', { caps: 'characters' }),
      input('country', { list: 'dl-country' })),
    h('fieldset', {}, h('legend', {}, 'Formaatti'),
      select('format', FORMATS, { empty: false }),
      select('size', SIZES),
      select('speed_rpm', SPEEDS.map((s) => ({ value: s, label: `${s} rpm` }))),
      input('discs', { type: 'number', inputmode: 'numeric', min: 1 })),
    h('fieldset', {}, h('legend', {}, 'Genre'),
      input('genre', { list: 'dl-genre' }),
      input('style', { list: 'dl-style' })),
    h('fieldset', {}, h('legend', {}, 'Kunto (Goldmine)'),
      select('media_grade', gradeOptions, { wide: true }),
      select('sleeve_grade', gradeOptions, { wide: true })),
    h('fieldset', {}, h('legend', {}, 'Hankinta ja sijainti'),
      input('location', { list: 'dl-location', ph: 'esim. Hylly 2 / B' }),
      input('purchase_date', { type: 'date' }),
      input('purchase_price', { inputmode: 'decimal', ph: '0,00', caps: 'none' }),
      input('purchase_place', { list: 'dl-place' })),
    h('fieldset', {}, h('legend', {}, 'Muut'),
      input('barcode', { inputmode: 'numeric', caps: 'none' }),
      input('discogs_id', { inputmode: 'numeric', caps: 'none' }),
      h('label', { class: 'field wide' }, h('span', {}, LABELS.notes),
        h('textarea', { name: 'notes', rows: 3 }, rec.notes || ''))),
    datalist('dl-artist', uniqueValues('artist')), datalist('dl-label', uniqueValues('label')),
    datalist('dl-country', uniqueValues('country')), datalist('dl-genre', uniqueValues('genre')),
    datalist('dl-style', uniqueValues('style')), datalist('dl-location', uniqueValues('location')),
    datalist('dl-place', uniqueValues('purchase_place')));
  form.querySelector('[name="purchase_price"]').value = rec.purchase_price ? rec.purchase_price.replace('.', ',') : '';

  const onPaste = (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); useImage(file); }
  };
  document.addEventListener('paste', onPaste);

  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit', form: 'editor-form' }, icon('check'), 'Tallenna');
  form.id = 'editor-form';
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const next = normalizeRecord({ ...rec, ...data });
    next.id = rec.id || newId();
    next.created_at = rec.created_at || nowIso();
    next.cover_file = rec.cover_file;
    const errors = validateRecord(next);
    form.querySelectorAll('.err').forEach((el) => { el.textContent = ''; });
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    if (Object.keys(errors).length) {
      for (const [k, msg] of Object.entries(errors)) {
        const el = form.querySelector(`#err-${k}`); if (el) el.textContent = msg;
        form.querySelector(`[name="${k}"]`)?.setAttribute('aria-invalid', 'true');
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
  if (!existing && !matchMedia('(pointer: coarse)').matches) form.querySelector('[name="artist"]').focus();
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
function today() {
  return new Date().toISOString().slice(0, 10);
}

async function exportData(kind) {
  try {
    if (kind === 'zip') {
      const enc = new TextEncoder();
      const covers = await db.allCovers();
      const used = new Set(state.records.map((r) => r.cover_file));
      const files = [{ name: CSV_NAME, data: enc.encode(recordsToCSV(state.records)) }];
      for (const c of covers) {
        if (c.full && used.has(c.file)) files.push({ name: c.file, data: new Uint8Array(await c.full.arrayBuffer()) });
      }
      await saveFile(new Blob([createZip(files)], { type: 'application/zip' }), `lp-kokoelma-${today()}.zip`);
      await saveSettings({ lastExportAt: nowIso() });
      renderBanner();
    } else {
      const delimiter = kind === 'csv-excel' ? ';' : ',';
      const sorted = [...state.records].sort(SORTS.artist.cmp);
      const csv = toCSV(FIELDS, sorted, { delimiter });
      await saveFile(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `lp-kokoelma-${today()}.csv`);
    }
  } catch (e) {
    console.error(e);
    toast(`Vienti epäonnistui: ${e.message}`, { kind: 'error' });
  }
}

async function openExport() {
  const kind = await choiceDialog('Valitse muoto:', [
    { value: 'zip', label: 'Varmuuskopio (ZIP)', desc: 'CSV + kaikki kansikuvat. Tällä voi palauttaa koko kokoelman.' },
    { value: 'csv-excel', label: 'CSV Exceliin', desc: 'Puolipiste-erotin, aukeaa suoraan suomenkielisessä Excelissä.' },
    { value: 'csv', label: 'CSV (standardi)', desc: 'Pilkkuerotin – Google Sheets, Numbers, muut ohjelmat.' },
  ], { title: 'Vie kokoelma' });
  if (kind) exportData(kind);
}

async function importFile() {
  const file = await pickFile('.csv,.zip,.txt,text/csv,application/zip');
  if (!file) return;
  try {
    let csvText; let images = new Map();
    if (/\.zip$/i.test(file.name) || file.type.includes('zip')) {
      const entries = await readZip(new Uint8Array(await file.arrayBuffer()));
      const csvName = entries.has(CSV_NAME) ? CSV_NAME : [...entries.keys()].find((n) => /\.csv$/i.test(n));
      if (!csvName) throw new Error('ZIP-paketista ei löytynyt CSV-tiedostoa');
      csvText = new TextDecoder().decode(entries.get(csvName));
      images = entries;
    } else {
      csvText = await file.text();
    }
    const { records: rows } = parseCSVObjects(csvText);
    const incoming = rows.map(fromImportRow).filter(Boolean);
    if (!incoming.length) throw new Error('Tiedostosta ei löytynyt levyjä. Tarvitaan vähintään sarakkeet artist/artisti ja title/nimi.');

    const byId = new Map(state.records.map((r) => [r.id, r]));
    const keys = new Set(state.records.map(duplicateKey));
    const fresh = incoming.filter((r) => !byId.has(r.id) && !keys.has(duplicateKey(r)));
    const updates = incoming.filter((r) => byId.has(r.id) && r.updated_at > byId.get(r.id).updated_at);
    const dupes = incoming.filter((r) => !byId.has(r.id) && keys.has(duplicateKey(r)));
    const imgCount = incoming.filter((r) => r.cover_file && images.has(r.cover_file)).length;

    const mode = await choiceDialog(
      `Tiedostossa ${incoming.length} levyä${imgCount ? ` ja ${imgCount} kansikuvaa` : ''}.`,
      [
        { value: 'merge', label: 'Yhdistä kokoelmaan', desc: `${fresh.length} uutta, ${updates.length} päivitettyä${dupes.length ? `, ${dupes.length} tuplaa ohitetaan` : ''}.` },
        { value: 'replace', label: 'Korvaa koko kokoelma', desc: `Nykyiset ${state.records.length} levyä poistetaan.`, danger: true },
      ],
      { title: 'Tuo levyt' });
    if (!mode) return;
    if (mode === 'replace' && state.records.length &&
      !(await confirmDialog(`Poistetaanko nykyiset ${state.records.length} levyä ja korvataan ne tuoduilla?`, { title: 'Korvaa kokoelma', ok: 'Korvaa', danger: true }))) return;

    const toWrite = mode === 'replace' ? incoming : [...fresh, ...updates];
    if (mode === 'replace') {
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
    render();
    scheduleSync();
    toast(`Tuotu ${toWrite.length} levyä`);
  } catch (e) {
    console.error(e);
    toast(`Tuonti epäonnistui: ${e.message}`, { kind: 'error', timeout: 8000 });
  }
}

// ── Tilastot ────────────────────────────────────────────────────────────────
function openStats() {
  const s = computeStats(state.records);
  const tile = (label, value) => h('div', { class: 'tile' }, h('div', { class: 'tile-value' }, value), h('div', { class: 'tile-label' }, label));
  const bars = (title, entries, limit = 10) => {
    if (!entries.length) return null;
    const max = Math.max(...entries.map((e) => e[1]));
    return h('section', { class: 'bars' }, h('h3', {}, title),
      entries.slice(0, limit).map(([k, v]) => h('div', { class: 'bar-row' },
        h('span', { class: 'bar-label' }, k),
        h('span', { class: 'bar-track' }, h('span', { class: 'bar', style: { width: `${(v / max) * 100}%` } })),
        h('span', { class: 'bar-value' }, v))));
  };
  openDialog({
    title: 'Tilastot',
    wide: true,
    body: h('div', { class: 'stats' },
      h('div', { class: 'tiles' },
        tile('levyä', s.total), tile('vinyyliä', s.discs), tile('artistia', s.artists),
        tile('ostohinnat yht.', formatMoney(s.value)), tile('kansikuvaa', `${s.withCover}/${s.total}`)),
      h('div', { class: 'bars-grid' },
        bars('Genret', s.byGenre), bars('Vuosikymmenet', s.byDecade, 20),
        bars('Formaatit', s.byFormat), bars('Levyjen kunto', s.byGrade))),
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
  if (id === s.backend) return;
  const target = getBackend(id, s);
  if (id === 'dropbox' && !s.dropboxAppKey) return toast('Anna ensin Dropboxin App key', { kind: 'error' });
  if (id === 'gdrive' && !s.googleClientId) return toast('Anna ensin Googlen Client ID', { kind: 'error' });
  const covers = state.thumbs.size;
  const msg = id === 'local'
    ? 'Kokoelma jää tälle laitteelle, mutta sitä ei enää synkronoida pilveen.'
    : `Kokoelma (${state.records.length} levyä, ${covers} kansikuvaa) kopioidaan paikkaan ${target.label}. Jos siellä on jo kokoelma, ne yhdistetään. Tämä laite pitää aina oman kopion, joten sovellus toimii myös ilman verkkoa.`;
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
        h('p', { class: 'hint' }, 'Kokoelma tallennetaan tiedostoon kokoelma.csv ja kansikuvat kansioon kannet/. Pilvessä sama kokoelma näkyy kaikilla laitteilla.'),
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
        h('details', { class: 'advanced', open: s.backend === 'dropbox' || s.backend === 'gdrive' || !!focus },
          h('summary', {}, 'Pilvipalveluiden avaimet'),
          keyField('dropboxAppKey', 'Dropbox App key', 'esim. a1b2c3d4e5f6g7h', 'dropbox.com/developers/apps → Create app → App folder. Ohje README:ssä.'),
          keyField('googleClientId', 'Google OAuth Client ID', '…apps.googleusercontent.com', 'console.cloud.google.com → Credentials → OAuth client ID (Web). Ohje README:ssä.'),
          keyField('remoteFolder', 'Kansion nimi pilvessä', 'LP-kokoelma'),
          h('p', { class: 'hint' }, `Paluuosoite, joka rekisteröidään palveluun: ${location.origin}${location.pathname}`))),
      h('section', {}, h('h3', {}, 'Teema'), themePicker()),
      h('section', {},
        h('h3', {}, 'Tiedot'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', onclick: openExport }, icon('download'), 'Vie / varmuuskopioi'),
          h('button', { class: 'btn', onclick: importFile }, icon('upload'), 'Tuo CSV tai ZIP')),
        h('p', { class: 'hint', id: 'storage-usage' }, s.lastExportAt ? `Viimeisin varmuuskopio ${formatDate(s.lastExportAt)}.` : 'Varmuuskopiota ei ole vielä otettu.'),
        h('button', { class: 'btn btn-danger-text', onclick: wipeAll }, icon('trash'), 'Tyhjennä tämän laitteen tiedot')),
      h('section', { class: 'about' },
        h('p', {}, `LP-kokoelma ${VERSION} · Tiedot pysyvät omissa tiedostoissasi – sovellus ei lähetä niitä minnekään muualle.`)));

    navigator.storage?.estimate?.().then(({ usage }) => {
      const el = body.querySelector('#storage-usage');
      if (el && usage) el.textContent += ` Laitteella käytössä ${(usage / 1048576).toFixed(1)} Mt.`;
    });
  };
  draw();
  const off = (() => { const prev = sync.onStatus; sync.onStatus = (st) => { prev(st); if (body.isConnected) draw(); }; return () => { sync.onStatus = prev; }; })();
  openDialog({ title: 'Asetukset', wide: true, body, onClose: off });
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
  search.addEventListener('input', debounce(() => { state.query = search.value; render(); }, 120));
  $('#sort').append(...Object.entries(SORTS).map(([k, v]) => h('option', { value: k }, v.label)));
  $('#sort').value = state.settings.sort;
  $('#sort').addEventListener('change', async (e) => { await saveSettings({ sort: e.target.value }); render(); });
  for (const k of ['genre', 'format', 'grade']) {
    $(`#f-${k}`).addEventListener('change', (e) => { state.filters[k] = e.target.value; render(); });
  }
  $('#filter-toggle').addEventListener('click', () => {
    const bar = $('#filters');
    bar.hidden = !bar.hidden;
    $('#filter-toggle').setAttribute('aria-expanded', String(!bar.hidden));
  });
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', async () => { await saveSettings({ view: b.dataset.view }); render(); }));
  $('#add').addEventListener('click', () => openEditor());
  $('#fab').addEventListener('click', () => openEditor());
  $('#btn-stats').addEventListener('click', openStats);
  $('#btn-theme').addEventListener('click', openThemes);
  $('#btn-settings').addEventListener('click', () => openSettings());
  $('#sync-status').addEventListener('click', onSyncStatusClick);

  // Pikanäppäimet läppärillä
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) {
      if (e.key === 'Escape' && document.activeElement === search) { search.value = ''; state.query = ''; render(); search.blur(); }
      return;
    }
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
  state.settings = { ...DEFAULT_SETTINGS, ...saved, customTheme: { ...DEFAULT_SETTINGS.customTheme, ...saved.customTheme } };
  // Julkaisun config.js täyttää tyhjät avaimet
  for (const k of ['dropboxAppKey', 'googleClientId']) if (!state.settings[k] && CONFIG[k]) state.settings[k] = CONFIG[k];
  refreshTheme();
  bindChrome();

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
