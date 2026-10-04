import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseCSVObjects, toCSV, detectDelimiter } from '../js/csv.js';
import { normalizeRecord, validateRecord, fromImportRow, normalizeGrade, duplicateKey, SORTS, matchesQuery, computeStats, FIELDS } from '../js/model.js';
import { threeWayMerge } from '../js/merge.js';
import { createZip, readZip, crc32 } from '../js/zip.js';

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

test('Malli: normalisointi', () => {
  const r = normalizeRecord({ artist: ' Pink Floyd ', title: 'Animals', year: '1977 (UK)', purchase_price: '12,5 €', purchase_date: '3.4.2021', media_grade: 'Very Good Plus (VG+)' });
  assert.equal(r.artist, 'Pink Floyd');
  assert.equal(r.year, '1977');
  assert.equal(r.purchase_price, '12.50');
  assert.equal(r.purchase_date, '2021-04-03');
  assert.equal(r.media_grade, 'VG+');
  assert.equal(normalizeGrade('nm'), 'NM');
  assert.equal(normalizeGrade('Near Mint'), 'NM');
  assert.equal(normalizeGrade('roskaa'), '');
});

test('Malli: validointi', () => {
  assert.deepEqual(Object.keys(validateRecord(normalizeRecord({}))).sort(), ['artist', 'title']);
  assert.ok(validateRecord(normalizeRecord({ artist: 'a', title: 'b', year: '1700' })).year);
  assert.deepEqual(validateRecord(normalizeRecord({ artist: 'a', title: 'b', year: '1969', purchase_price: '10' })), {});
});

test('Malli: Discogs-viennin rivi tuodaan oikein', () => {
  const r = fromImportRow({
    'Catalog#': 'SHVL 804', Artist: 'Pink Floyd', Title: 'The Dark Side Of The Moon', Label: 'Harvest',
    Format: 'LP, Album', Released: '1973', release_id: '1873013',
    'Collection Media Condition': 'Near Mint (NM or M-)', 'Collection Sleeve Condition': 'Very Good Plus (VG+)',
  });
  assert.equal(r.catalog_number, 'SHVL 804');
  assert.equal(r.format, 'LP');
  assert.equal(r.discogs_id, '1873013');
  assert.equal(r.sleeve_grade, 'VG+');
  assert.ok(r.id && r.created_at && r.updated_at);
  assert.equal(fromImportRow({ Artist: '', Title: '' }), null);
});

test('Malli: tuplat, lajittelu ja haku', () => {
  assert.equal(duplicateKey({ artist: 'The Beatles', title: 'Abbey Road!' }), duplicateKey({ artist: 'beatles', title: 'abbey road' }));
  const list = [{ artist: 'The Who', year: '1971', title: 'b' }, { artist: 'Abba', year: '1976', title: 'a' }, { artist: 'Wigwam', year: '1974', title: 'c' }];
  assert.deepEqual([...list].sort(SORTS.artist.cmp).map((r) => r.artist), ['Abba', 'The Who', 'Wigwam']);
  assert.ok(matchesQuery({ artist: 'Wigwam', title: 'Being', genre: 'Prog' }, 'wig prog'));
  assert.ok(!matchesQuery({ artist: 'Wigwam', title: 'Being' }, 'abba'));
});

test('Malli: tilastot', () => {
  const s = computeStats([
    { artist: 'A', year: '1971', genre: 'Rock', purchase_price: '10.00', discs: '2', cover_file: 'x' },
    { artist: 'B', year: '1975', genre: 'Rock', purchase_price: '', discs: '1', cover_file: '' },
  ]);
  assert.equal(s.total, 2); assert.equal(s.discs, 3); assert.equal(s.value, 10); assert.equal(s.withCover, 1);
  assert.deepEqual(s.byDecade, [['1970-luku', 2]]);
  assert.ok(FIELDS.includes('cover_file'));
});

const rec = (id, t, extra = {}) => ({ id, artist: 'A', title: id, updated_at: t, ...extra });

test('Yhdistäminen: uudempi voittaa, poistot molempiin suuntiin', () => {
  const base = { a: '1', b: '1', c: '1' };
  const local = [rec('a', '2'), rec('b', '1'), rec('d', '1')]; // a muokattu, c poistettu täällä, d uusi
  const remote = [rec('a', '1'), rec('c', '1'), rec('e', '3')]; // b poistettu muualla, e uusi
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

test('Yhdistäminen: muuttumaton ei aiheuta kirjoitusta', () => {
  const m = threeWayMerge([rec('a', '1')], [rec('a', '1')], { a: '1' });
  assert.equal(m.remoteChanged, false);
  assert.equal(m.localUpserts.length, 0);
});

test('ZIP: kirjoitus ja luku, UTF-8-nimet', async () => {
  const enc = new TextEncoder();
  const files = [
    { name: 'kokoelma.csv', data: enc.encode('id,artist\n1,Hörökkä') },
    { name: 'kannet/1-abc.jpg', data: new Uint8Array([255, 216, 255, 0, 1, 2]) },
  ];
  const zip = createZip(files);
  const out = await readZip(zip);
  assert.equal(new TextDecoder().decode(out.get('kokoelma.csv')), 'id,artist\n1,Hörökkä');
  assert.deepEqual([...out.get('kannet/1-abc.jpg')], [255, 216, 255, 0, 1, 2]);
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
});

test('ZIP: deflate-pakattu tiedosto luetaan', async () => {
  const { deflateRawSync } = await import('node:zlib');
  const data = new TextEncoder().encode('a'.repeat(1000));
  const comp = new Uint8Array(deflateRawSync(data));
  // Rakenna zip käsin vaihtamalla menetelmä ja koot
  const zip = createZip([{ name: 'x.txt', data: comp }]);
  const v = new DataView(zip.buffer);
  v.setUint16(8, 8, true); v.setUint32(14, crc32(data), true); v.setUint32(22, 1000, true);
  const cd = 30 + 5 + comp.length;
  v.setUint16(cd + 10, 8, true); v.setUint32(cd + 16, crc32(data), true); v.setUint32(cd + 24, 1000, true);
  const out = await readZip(zip);
  assert.equal(out.get('x.txt').length, 1000);
});

test('Malli: Discogsin monilevyformaatti "2xLP, Album"', () => {
  const r = fromImportRow({ Artist: 'Daft Punk', Title: 'Discovery', Format: '2xLP, Album' });
  assert.equal(r.format, 'LP');
  assert.equal(r.discs, '2');
});
