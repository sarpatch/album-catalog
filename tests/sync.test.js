import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine, CSV_NAME } from '../js/sync.js';

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
function memoryCloud() {
  const files = new Map();
  return {
    id: 'memory', files,
    async connect() { return true; },
    async read(p) { return files.has(p) ? files.get(p) : null; },
    async write(p, b) { files.set(p, new Blob([await b.arrayBuffer()])); },
    async remove(p) { files.delete(p); },
  };
}

const device = (cloud) => {
  const store = memoryStore();
  const engine = new SyncEngine({ store, makeThumb: async (b) => b });
  engine.setBackend(cloud, { remoteFolder: 'LP' });
  return { store, engine };
};

const rec = (id, t, extra = {}) => ({ id, artist: 'Wigwam', title: `Levy ${id}`, created_at: t, updated_at: t, cover_file: '', ...extra });

test('kaksi laitetta synkronoituu: lisäys, kansikuva, muokkaus ja poisto', async () => {
  const cloud = memoryCloud();
  const phone = device(cloud);
  const laptop = device(cloud);

  // Kännykällä lisätään levy kansikuvan kanssa
  const cover = new Blob([new Uint8Array([1, 2, 3])]);
  await phone.store.putRecords([rec('a', '2026-01-01T00:00:00Z', { cover_file: 'kannet/a-1.jpg' })]);
  await phone.store.putCover({ id: 'a', file: 'kannet/a-1.jpg', full: cover, thumb: cover, synced: {} });
  await phone.engine.sync();
  assert.ok(cloud.files.has(CSV_NAME));
  assert.ok(cloud.files.has('kannet/a-1.jpg'));
  assert.equal(phone.engine.status.state, 'ok');

  // Läppäri hakee levyn ja kuvan
  await laptop.engine.sync();
  assert.equal(laptop.store.records.get('a').title, 'Levy a');
  assert.equal(laptop.store.covers.get('a').file, 'kannet/a-1.jpg');

  // Läppärillä muokataan, kännykkä saa muutoksen
  await laptop.store.putRecords([{ ...laptop.store.records.get('a'), title: 'Being', updated_at: '2026-02-01T00:00:00Z' }]);
  await laptop.engine.sync();
  await phone.engine.sync();
  assert.equal(phone.store.records.get('a').title, 'Being');

  // Kännykällä poistetaan → poistuu läppäriltä ja pilvestä kuvineen
  await phone.store.deleteRecords(['a']);
  await phone.engine.queueRemoteDelete('kannet/a-1.jpg');
  await phone.engine.sync();
  assert.ok(!cloud.files.has('kannet/a-1.jpg'));
  await laptop.engine.sync();
  assert.equal(laptop.store.records.size, 0);
  assert.equal(laptop.store.covers.size, 0);
});

test('käsin CSV:hen lisätty rivi saa id:n ja tallentuu takaisin', async () => {
  const cloud = memoryCloud();
  await cloud.write(CSV_NAME, new Blob(['artist;title;year\nHurriganes;Roadrunner;1974\n']));
  const d = device(cloud);
  await d.engine.sync();
  const [r] = d.store.records.values();
  assert.equal(r.artist, 'Hurriganes');
  assert.equal(r.year, '1974');
  const text = await (await cloud.read(CSV_NAME)).text();
  assert.ok(text.includes(r.id), 'id kirjoitettiin pilven CSV:hen');
});

test('tallennuspaikan vaihto siirtää kaiken uuteen paikkaan', async () => {
  const oldCloud = memoryCloud();
  const d = device(oldCloud);
  const img = new Blob([new Uint8Array([9])]);
  await d.store.putRecords([rec('x', '2026-01-01T00:00:00Z', { cover_file: 'kannet/x-9.jpg' })]);
  await d.store.putCover({ id: 'x', file: 'kannet/x-9.jpg', full: img, thumb: img, synced: {} });
  await d.engine.sync();

  const newCloud = { ...memoryCloud(), id: 'other' };
  d.engine.setBackend(newCloud, { remoteFolder: 'LP' });
  await d.engine.sync();
  assert.ok(newCloud.files.has(CSV_NAME));
  assert.ok(newCloud.files.has('kannet/x-9.jpg'));
});

test('ei verkkoyhteyttä / kirjautumatta → tila kerrotaan, ei virhettä', async () => {
  const cloud = { ...memoryCloud(), async connect() { return false; } };
  const d = device(cloud);
  const res = await d.engine.sync();
  assert.equal(d.engine.status.state, 'login');
  assert.equal(res.changed, false);
});
