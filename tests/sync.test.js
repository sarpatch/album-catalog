import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine, CSV_NAME } from '../js/sync.js';
import { SCHEMA_FILE, schemaToJSON, parseSchema } from '../js/schema.js';
import { defaultSchema } from './helpers.js';

// Muistissa toimiva laite (IndexedDB:n korvike)
function memoryStore() {
  const records = new Map(); const covers = new Map(); const meta = new Map();
  return {
    records, covers,
    async allRecords() { return [...records.values()]; },
    async putRecords(l) { for (const r of l) records.set(r.id, r); },
    async deleteRecords(ids) { for (const id of ids) { records.delete(id); covers.delete(id); } },
    async getCover(id) { return covers.get(id); },
    async putCover(c) { covers.set(c.id, c); },
    async deleteCover(id) { covers.delete(id); },
    async getMeta(k, f) { return meta.has(k) ? structuredClone(meta.get(k)) : f; },
    async setMeta(k, v) { meta.set(k, structuredClone(v)); },
  };
}

// Muistissa toimiva "pilvi" (Dropboxin / Driven korvike)
function memoryCloud(id = 'memory') {
  const files = new Map();
  return {
    id, files,
    async connect() { return true; },
    async read(p) { return files.has(p) ? files.get(p) : null; },
    async write(p, b) { files.set(p, new Blob([await b.arrayBuffer()])); },
    async remove(p) { files.delete(p); },
    async text(p) { return files.get(p).text(); },
  };
}

function device(cloud) {
  const store = memoryStore();
  const dev = { store, schema: defaultSchema() };
  dev.engine = new SyncEngine({
    store, makeThumb: async (b) => b,
    getSchema: () => dev.schema,
    setSchema: async (s) => { dev.schema = s; },
  });
  dev.engine.setBackend(cloud, { remoteFolder: 'LP' });
  return dev;
}

const rec = (id, t, extra = {}) => ({ id, artist: 'Wigwam', title: `Levy ${id}`, status: 'Varastossa', created_at: t, updated_at: t, cover_file: '', ...extra });

test('kaksi laitetta synkronoituu: lisäys, kansikuva, muokkaus ja poisto', async () => {
  const cloud = memoryCloud();
  const phone = device(cloud);
  const laptop = device(cloud);

  const cover = new Blob([new Uint8Array([1, 2, 3])]);
  await phone.store.putRecords([rec('a', '2026-01-01T00:00:00Z', { cover_file: 'kannet/a-1.jpg' })]);
  await phone.store.putCover({ id: 'a', file: 'kannet/a-1.jpg', full: cover, thumb: cover, synced: {} });
  await phone.engine.sync();
  assert.ok(cloud.files.has(CSV_NAME));
  assert.ok(cloud.files.has(SCHEMA_FILE), 'kenttämäärittely kirjoitetaan pilveen muokattavaksi');
  assert.ok(cloud.files.has('kannet/a-1.jpg'));
  assert.equal(phone.engine.status.state, 'ok');

  await laptop.engine.sync();
  assert.equal(laptop.store.records.get('a').title, 'Levy a');
  assert.equal(laptop.store.covers.get('a').file, 'kannet/a-1.jpg');

  await laptop.store.putRecords([{ ...laptop.store.records.get('a'), status: 'Myyty', updated_at: '2026-02-01T00:00:00Z' }]);
  await laptop.engine.sync();
  await phone.engine.sync();
  assert.equal(phone.store.records.get('a').status, 'Myyty');

  await phone.store.deleteRecords(['a']);
  await phone.engine.queueRemoteDelete('kannet/a-1.jpg');
  await phone.engine.sync();
  assert.ok(!cloud.files.has('kannet/a-1.jpg'));
  await laptop.engine.sync();
  assert.equal(laptop.store.records.size, 0);
  assert.equal(laptop.store.covers.size, 0);
});

test('kentat.json: käsin lisätty kenttä tulee käyttöön kaikilla laitteilla ilman päivitystä', async () => {
  const cloud = memoryCloud();
  const phone = device(cloud);
  const laptop = device(cloud);
  await phone.store.putRecords([rec('a', '2026-01-01T00:00:00Z')]);
  await phone.engine.sync();
  await laptop.engine.sync();

  // Käyttäjä muokkaa tiedostoa Dropboxissa tekstieditorilla
  const json = JSON.parse(await cloud.text(SCHEMA_FILE));
  json.fields.push({ key: 'signeerattu', label: 'Signeerattu', type: 'checkbox' });
  await cloud.write(SCHEMA_FILE, new Blob([JSON.stringify(json, null, 2)]));

  const res = await phone.engine.sync();
  assert.ok(res.changed);
  assert.ok(phone.schema.fields.some((f) => f.key === 'signeerattu'));
  await laptop.engine.sync();
  assert.ok(laptop.schema.fields.some((f) => f.key === 'signeerattu'));

  // Uusi sarake näkyy CSV:ssä, kun levyä muokataan
  await phone.store.putRecords([{ ...phone.store.records.get('a'), signeerattu: 'kyllä', updated_at: '2026-03-01T00:00:00Z' }]);
  await phone.engine.sync();
  const header = (await cloud.text(CSV_NAME)).split('\r\n')[0];
  assert.ok(header.includes('signeerattu'));
  await laptop.engine.sync();
  assert.equal(laptop.store.records.get('a').signeerattu, 'kyllä');
});

test('kentat.json: sovelluksessa tehty muutos kirjoitetaan pilveen', async () => {
  const cloud = memoryCloud();
  const d = device(cloud);
  await d.engine.sync();
  d.schema = { ...d.schema, updated_at: 'x', fields: [...d.schema.fields, { key: 'painos', label: 'Painos', type: 'text', group: 'Muut' }] };
  await d.engine.sync();
  assert.ok((await cloud.text(SCHEMA_FILE)).includes('"painos"'));
  assert.equal(schemaToJSON(parseSchema(await cloud.text(SCHEMA_FILE)).schema), schemaToJSON(d.schema));
});

test('kentat.json: rikkinäistä tiedostoa ei ylikirjoiteta, levyt synkronoituvat silti', async () => {
  const cloud = memoryCloud();
  const d = device(cloud);
  await d.engine.sync();
  await cloud.write(SCHEMA_FILE, new Blob(['{ "fields": [ oops ] }']));
  await d.store.putRecords([rec('b', '2026-01-05T00:00:00Z')]);
  const res = await d.engine.sync();
  assert.match(res.schema.error, /ei ole kelvollista JSONia/);
  assert.equal(await cloud.text(SCHEMA_FILE), '{ "fields": [ oops ] }');
  assert.ok((await cloud.text(CSV_NAME)).includes('Levy b'));
});

test('käsin CSV:hen lisätty rivi saa id:n ja oletusarvot', async () => {
  const cloud = memoryCloud();
  await cloud.write(CSV_NAME, new Blob(['Artisti;Levyn nimi;Vuosi;Status\nHurriganes;Roadrunner;1974;tilattu\n']));
  const d = device(cloud);
  await d.engine.sync();
  const [r] = d.store.records.values();
  assert.equal(r.artist, 'Hurriganes');
  assert.equal(r.year, '1974');
  assert.equal(r.status, 'Tilattu');
  assert.equal(r.format, 'LP');
  assert.ok((await cloud.text(CSV_NAME)).includes(r.id), 'id kirjoitettiin pilven CSV:hen');
});

test('sovelluksen omat rivit säilyvät merkki merkiltä (ei turhia kirjoituksia)', async () => {
  const cloud = memoryCloud();
  const d = device(cloud);
  await d.store.putRecords([rec('a', '2026-01-01T00:00:00Z', { purchase_price: '12,5', oma_sarake: 'x' })]);
  await d.engine.sync();
  const before = await cloud.text(CSV_NAME);
  const res = await d.engine.sync();
  assert.equal(res.merge.remoteChanged, false);
  assert.equal(await cloud.text(CSV_NAME), before);
  assert.ok(before.includes('oma_sarake'));
});

test('tallennuspaikan vaihto siirtää kaiken uuteen paikkaan', async () => {
  const d = device(memoryCloud());
  const img = new Blob([new Uint8Array([9])]);
  await d.store.putRecords([rec('x', '2026-01-01T00:00:00Z', { cover_file: 'kannet/x-9.jpg' })]);
  await d.store.putCover({ id: 'x', file: 'kannet/x-9.jpg', full: img, thumb: img, synced: {} });
  await d.engine.sync();

  const newCloud = memoryCloud('other');
  d.engine.setBackend(newCloud, { remoteFolder: 'LP' });
  await d.engine.sync();
  assert.ok(newCloud.files.has(CSV_NAME));
  assert.ok(newCloud.files.has(SCHEMA_FILE));
  assert.ok(newCloud.files.has('kannet/x-9.jpg'));
});

test('kirjautumatta → tila kerrotaan, ei virhettä', async () => {
  const cloud = { ...memoryCloud(), async connect() { return false; } };
  const d = device(cloud);
  const res = await d.engine.sync();
  assert.equal(d.engine.status.state, 'login');
  assert.equal(res.changed, false);
});
