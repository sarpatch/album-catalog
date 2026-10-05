import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseCSVObjects, toCSV, detectDelimiter } from '../js/csv.js';
import { normalizeRecord, validateRecord, fromImportRow, mapHeaders, fieldsForHeaders, duplicateKey, matchesQuery, computeStats, emptyRecord } from '../js/model.js';
import { threeWayMerge } from '../js/merge.js';
import { createZip, readZip, crc32 } from '../js/zip.js';
import { defaultSchema } from './helpers.js';

const schema = defaultSchema();
const importRow = (row) => fromImportRow(schema, row, mapHeaders(schema, Object.keys(row)).mapping);

test('CSV: lainausmerkit, rivinvaihdot kentässä ja BOM', () => {
  const text = '﻿a,b,c\r\n1,"x, y","rivi1\nrivi2"\r\n2,"sanoi ""moi""",\r\n';
  assert.deepEqual(parseCSV(text), [
    ['a', 'b', 'c'],
    ['1', 'x, y', 'rivi1\nrivi2'],
    ['2', 'sanoi "moi"', ''],
  ]);
});

test('CSV: puolipiste-erotin tunnistetaan (suomalainen Excel)', () => {
  assert.equal(detectDelimiter('Artisti;Nimi;Vuosi\nA;B;1970'), ';');
  const { records } = parseCSVObjects('Artisti;Nimi\n"Eppu Normaali";"Aknepop"');
  assert.deepEqual(records, [{ Artisti: 'Eppu Normaali', Nimi: 'Aknepop' }]);
});

test('CSV: sulkematon lainausmerkki antaa virheen', () => {
  assert.throws(() => parseCSV('a,"b\n'));
});

test('CSV: edestakainen muunnos säilyttää datan ja suojaa kaavoilta', () => {
  const recs = [{ a: '=SUM(A1)', b: 'ääkköset "lainaus"', c: '-12.5' }, { a: '', b: 'rivi\nkaksi', c: '@x' }];
  const csv = toCSV(['a', 'b', 'c'], recs);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes("'=SUM(A1)"), 'kaava suojataan heittomerkillä');
  assert.ok(csv.includes(',-12.5'), 'negatiivista lukua ei suojata');
  assert.deepEqual(parseCSVObjects(csv).records, recs);
});

test('Malli: uusi levy saa oletusarvot (status Varastossa, LP)', () => {
  const r = emptyRecord(schema);
  assert.equal(r.status, 'Varastossa');
  assert.equal(r.format, 'LP');
  assert.equal(r.artist, '');
});

test('Malli: normalisointi kenttätyyppien mukaan', () => {
  const r = normalizeRecord(schema, {
    artist: ' Pink  Floyd ', title: 'Animals', year: '1977 (UK)', purchase_price: '12,5 €',
    purchase_date: '3.4.2021', media_grade: 'Very Good Plus (VG+)', status: 'myyty', oma: ' säilyy ',
  });
  assert.equal(r.artist, 'Pink Floyd');
  assert.equal(r.year, '1977');
  assert.equal(r.purchase_price, '12.50');
  assert.equal(r.purchase_date, '2021-04-03');
  assert.equal(r.media_grade, 'VG+');
  assert.equal(r.status, 'Myyty', 'valinta yhtenäistetään vaihtoehdon kirjoitusasuun');
  assert.equal(r.oma, ' säilyy ', 'määrittelemättömät sarakkeet säilyvät koskemattomina');
});

test('Malli: validointi', () => {
  assert.deepEqual(Object.keys(validateRecord(schema, normalizeRecord(schema, {}))).sort(), ['artist', 'title']);
  assert.ok(validateRecord(schema, normalizeRecord(schema, { artist: 'a', title: 'b', year: '1700' })).year);
  assert.ok(validateRecord(schema, { artist: 'a', title: 'b', purchase_price: '-3.00' }).purchase_price);
  assert.ok(validateRecord(schema, { artist: 'a', title: 'b', media_grade: 'hyvä' }).media_grade);
  assert.deepEqual(validateRecord(schema, normalizeRecord(schema, { artist: 'a', title: 'b', year: '1969', purchase_price: '10' })), {});
});

test('Malli: Discogs-viennin rivi tuodaan oikein', () => {
  const r = importRow({
    'Catalog#': 'SHVL 804', Artist: 'Pink Floyd', Title: 'The Dark Side Of The Moon', Label: 'Harvest',
    Format: 'LP, Album', Released: '1973', release_id: '1873013',
    'Collection Media Condition': 'Near Mint (NM or M-)', 'Collection Sleeve Condition': 'Very Good Plus (VG+)',
  });
  assert.equal(r.catalog_number, 'SHVL 804');
  assert.equal(r.format, 'LP');
  assert.equal(r.discogs_id, '1873013');
  assert.equal(r.media_grade, 'NM');
  assert.equal(r.sleeve_grade, 'VG+');
  assert.equal(r.status, 'Varastossa', 'puuttuva status saa oletusarvon');
  assert.ok(r.id && r.created_at && r.updated_at);
  assert.equal(importRow({ Artist: '', Title: '' }), null);
});

test('Malli: Discogsin monilevyformaatti "2xLP, Album"', () => {
  const r = importRow({ Artist: 'Daft Punk', Title: 'Discovery', Format: '2xLP, Album' });
  assert.equal(r.format, 'LP');
  assert.equal(r.discs, '2');
});

test('Malli: suomenkieliset sarakenimet ja tuntemattomat sarakkeet', () => {
  const headers = ['Artisti', 'Levyn nimi', 'Status', 'Ostohinta', 'Signeerattu', 'Painos'];
  const { mapping, unknown } = mapHeaders(schema, headers);
  assert.equal(mapping.get('Artisti'), 'artist');
  assert.equal(mapping.get('Ostohinta'), 'purchase_price');
  assert.deepEqual(unknown, ['Signeerattu', 'Painos']);
  const added = fieldsForHeaders(schema, unknown);
  assert.deepEqual(added.map((f) => f.key), ['signeerattu', 'painos']);
});

test('Malli: tuplat ja haku', () => {
  assert.equal(duplicateKey({ artist: 'The Beatles', title: 'Abbey Road!' }), duplicateKey({ artist: 'beatles', title: 'abbey road' }));
  assert.ok(matchesQuery({ artist: 'Wigwam', title: 'Being', genre: 'Prog' }, 'wig prog'));
  assert.ok(matchesQuery({ artist: 'Wigwam', painos: 'Ensipainos' }, 'ensipainos'), 'haku kattaa myös omat kentät');
  assert.ok(!matchesQuery({ artist: 'Wigwam', title: 'Being', id: 'abba' }, 'abba'), 'id:tä ei haeta');
});

test('Malli: tilastot', () => {
  const s = computeStats(schema, [
    { artist: 'A', year: '1971', genre: 'Rock', status: 'Myyty', purchase_price: '10.00', sale_price: '25.00', discs: '2', cover_file: 'x' },
    { artist: 'B', year: '1975', genre: 'Rock', status: 'Varastossa', purchase_price: '', discs: '1', cover_file: '' },
  ]);
  assert.equal(s.total, 2); assert.equal(s.discs, 3); assert.equal(s.withCover, 1);
  assert.deepEqual(s.money.map((m) => m.value), [10, 25]);
  const byLabel = Object.fromEntries(s.distributions.map((d) => [d.label, d.entries]));
  assert.deepEqual(byLabel.Status, [['Varastossa', 1], ['Myyty', 1]], 'status vaihtoehtojen järjestyksessä');
  assert.deepEqual(byLabel.Vuosikymmenet, [['1970-luku', 2]]);
});

const rec = (id, t, extra = {}) => ({ id, artist: 'A', title: id, updated_at: t, ...extra });

test('Yhdistäminen: uudempi voittaa, poistot molempiin suuntiin', () => {
  const base = { a: '1', b: '1', c: '1' };
  const local = [rec('a', '2'), rec('b', '1'), rec('d', '1')];
  const remote = [rec('a', '1'), rec('c', '1'), rec('e', '3')];
  const m = threeWayMerge(local, remote, base);
  assert.deepEqual(m.merged.map((r) => r.id).sort(), ['a', 'd', 'e']);
  assert.deepEqual(m.localDeletes, ['b']);
  assert.deepEqual(m.localUpserts.map((r) => r.id), ['e']);
  assert.equal(m.remoteChanged, true);
});

test('Yhdistäminen: ensimmäinen synkronointi yhdistää molemmat', () => {
  const m = threeWayMerge([rec('a', '1')], [rec('b', '1')], {});
  assert.deepEqual(m.merged.map((r) => r.id).sort(), ['a', 'b']);
  assert.equal(m.localDeletes.length, 0);
});

test('Yhdistäminen: käsin muokattu CSV (sama aikaleima) voittaa', () => {
  const m = threeWayMerge([rec('a', '1', { title: 'vanha' })], [rec('a', '1', { title: 'uusi' })], { a: '1' }, () => '9');
  assert.equal(m.merged[0].title, 'uusi');
  assert.equal(m.merged[0].updated_at, '9');
  assert.ok(m.remoteChanged);
});

test('Yhdistäminen: muuttumaton ei aiheuta kirjoitusta, puuttuva sarake = tyhjä', () => {
  const m = threeWayMerge([rec('a', '1')], [rec('a', '1', { uusi_kentta: '' })], { a: '1' });
  assert.equal(m.remoteChanged, false);
  assert.equal(m.localUpserts.length, 0);
});

test('ZIP: kirjoitus ja luku, UTF-8-nimet', async () => {
  const enc = new TextEncoder();
  const files = [
    { name: 'kokoelma.csv', data: enc.encode('id,artist\n1,Hörökkä') },
    { name: 'kannet/1-abc.jpg', data: new Uint8Array([255, 216, 255, 0, 1, 2]) },
  ];
  const out = await readZip(createZip(files));
  assert.equal(new TextDecoder().decode(out.get('kokoelma.csv')), 'id,artist\n1,Hörökkä');
  assert.deepEqual([...out.get('kannet/1-abc.jpg')], [255, 216, 255, 0, 1, 2]);
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
});

test('ZIP: deflate-pakattu tiedosto luetaan', async () => {
  const { deflateRawSync } = await import('node:zlib');
  const data = new TextEncoder().encode('a'.repeat(1000));
  const comp = new Uint8Array(deflateRawSync(data));
  const zip = createZip([{ name: 'x.txt', data: comp }]);
  const v = new DataView(zip.buffer);
  v.setUint16(8, 8, true); v.setUint32(14, crc32(data), true); v.setUint32(22, 1000, true);
  const cd = 30 + 5 + comp.length;
  v.setUint16(cd + 10, 8, true); v.setUint32(cd + 16, crc32(data), true); v.setUint32(cd + 24, 1000, true);
  const out = await readZip(zip);
  assert.equal(out.get('x.txt').length, 1000);
});
