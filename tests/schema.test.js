import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSchema, parseSchema, schemaToJSON, mergeSchemas, normalizeValue, validateValue, formatValue,
  compareValues, csvColumns, slugify, uniqueKey, parseNumber, editableText,
} from '../js/schema.js';
import { applyView, sortRecords, matchesFilter, valueCounts, describeFilter, isActive, activeFilterCount } from '../js/query.js';
import { defaultSchema } from './helpers.js';

const schema = defaultSchema();
const F = Object.fromEntries(schema.fields.map((f) => [f.key, f]));

test('Määrittely: oletustiedosto on kelvollinen ja sisältää statuksen', () => {
  assert.deepEqual(F.status.options, ['Tilattu', 'Varastossa', 'Myyty']);
  assert.equal(F.status.default, 'Varastossa');
  assert.equal(F.purchase_price.type, 'money');
  assert.equal(F.purchase_date.type, 'date');
});

test('Määrittely: virheet korjataan ja niistä varoitetaan', () => {
  const { schema: s, warnings } = normalizeSchema({
    fields: [
      { label: 'Signeerattu', type: 'checkbox' },
      { key: 'id', label: 'Varattu' },
      { key: 'signeerattu', label: 'Tupla' },
      { key: 'kunto2', type: 'outo' },
      { key: 'paino', type: 'select', options: [] },
      { key: 'BAD KEY', label: 'Hyllyrivi' },
      'roskaa',
    ],
  });
  assert.deepEqual(s.fields.map((f) => f.key), ['artist', 'title', 'signeerattu', 'kunto2', 'paino', 'bad_key']);
  assert.equal(s.fields.find((f) => f.key === 'kunto2').type, 'text');
  assert.equal(s.fields.find((f) => f.key === 'paino').type, 'text');
  assert.ok(warnings.length >= 5);
});

test('Määrittely: rikkinäinen JSON antaa selkeän virheen', () => {
  assert.throws(() => parseSchema('{ "fields": [ { "key": "x", } ] }'), /kentat\.json ei ole kelvollista JSONia/);
});

test('Määrittely: tallennus ja luku ovat käänteisiä, listat yhdellä rivillä', () => {
  const text = schemaToJSON(schema);
  assert.ok(text.includes('"options": ["Tilattu", "Varastossa", "Myyty"]'));
  assert.equal(schemaToJSON(parseSchema(text).schema), text);
});

test('Määrittely: yhdistäminen lisää vain puuttuvat kentät', () => {
  const extra = normalizeSchema({ fields: [{ key: 'artist', label: 'X' }, { key: 'painos', label: 'Painos' }] }).schema;
  const { schema: merged, added } = mergeSchemas(schema, extra);
  assert.deepEqual(added.map((f) => f.key), ['painos']);
  assert.equal(merged.fields.find((f) => f.key === 'artist').label, 'Artisti');
});

test('Avaimet: slugify ja yksilöllisyys', () => {
  assert.equal(slugify('Myyntipäivä (arvio)'), 'myyntipaiva_arvio');
  assert.equal(slugify('2. painos'), 'f_2_painos');
  assert.equal(uniqueKey(['painos', 'painos_2'], 'Painos'), 'painos_3');
  assert.equal(uniqueKey([], 'id'), 'id_2');
});

test('Arvot: luvut, päivät, valinnat, valintaruutu, tähdet, linkit', () => {
  assert.equal(parseNumber('1.234,50 €'), 1234.5);
  assert.equal(normalizeValue(F.year, '1977 (UK)'), '1977');
  assert.equal(normalizeValue(F.purchase_date, '24.12.21'), '2021-12-24');
  assert.equal(normalizeValue({ type: 'checkbox' }, 'X'), 'kyllä');
  assert.equal(normalizeValue({ type: 'checkbox' }, 'ei'), '');
  assert.equal(normalizeValue({ type: 'rating' }, '★★★'), '3');
  assert.equal(normalizeValue({ type: 'rating' }, '9'), '5');
  assert.equal(normalizeValue({ type: 'url' }, 'discogs.com/release/1'), 'https://discogs.com/release/1');
  assert.equal(normalizeValue(F.status, 'TILATTU'), 'Tilattu');
  assert.equal(normalizeValue(F.status, 'Lainassa'), 'Lainassa', 'tuntematon valinta säilyy');
});

test('Arvot: validointi ja muotoilu', () => {
  assert.equal(validateValue(F.artist, ''), 'Artisti on pakollinen');
  assert.equal(validateValue(F.year, '1500'), 'Pienin sallittu arvo on 1890');
  assert.equal(validateValue(F.purchase_date, '2021-02-30x'), 'Anna päivämäärä, esim. 24.12.2021');
  assert.equal(validateValue({ type: 'url', label: 'L' }, 'ei osoite'), 'Virheellinen osoite');
  assert.equal(formatValue(F.purchase_price, '12.50').replace(/\s/g, ' '), '12,50 €');
  assert.equal(formatValue(F.purchase_date, '2021-04-03'), '3.4.2021');
  assert.equal(formatValue({ type: 'rating' }, '3'), '★★★☆☆');
  assert.equal(editableText(F.purchase_price, '12.50'), '12,50');
});

test('Vertailu: tyypin mukainen järjestys', () => {
  assert.ok(compareValues(F.year, '999', '1000') < 0, 'luvut numeerisesti');
  assert.ok(compareValues(F.status, 'Tilattu', 'Myyty') < 0, 'valinnat vaihtoehtojen järjestyksessä');
  assert.ok(compareValues(F.media_grade, 'NM', 'VG') < 0, 'kunto asteikon järjestyksessä');
  assert.ok(compareValues(F.artist, 'The Who', 'Wigwam') < 0, 'The-sana ohitetaan');
  assert.ok(compareValues(F.artist, 'Ääniwalli', 'Öljy') < 0, 'suomalainen aakkosjärjestys');
});

test('CSV-sarakkeet: määrittelyn järjestys, ylimääräiset säilyvät', () => {
  const cols = csvColumns(schema, [{ id: '1', artist: 'a', vanha_kentta: 'x' }]);
  assert.equal(cols[0], 'id');
  assert.equal(cols[1], 'artist');
  assert.ok(cols.indexOf('vanha_kentta') > cols.indexOf('notes'));
  assert.deepEqual(cols.slice(-3), ['cover_file', 'created_at', 'updated_at']);
});

const rows = [
  { id: '1', artist: 'Wigwam', title: 'Being', year: '1974', status: 'Varastossa', purchase_price: '45.00', genre: 'Rock', created_at: '2026-01-03' },
  { id: '2', artist: 'The Beatles', title: 'Abbey Road', year: '1969', status: 'Myyty', purchase_price: '35.00', genre: 'Rock', created_at: '2026-01-01' },
  { id: '3', artist: 'Miles Davis', title: 'Kind Of Blue', year: '1959', status: 'Tilattu', purchase_price: '', genre: 'Jazz', created_at: '2026-01-02' },
  { id: '4', artist: 'Abba', title: 'Arrival', year: '', status: 'Varastossa', purchase_price: '8.00', genre: '', created_at: '2026-01-04' },
];
const ids = (list) => list.map((r) => r.id).join(',');

test('Lajittelu: mikä tahansa kenttä, suunta, tyhjät viimeisenä', () => {
  assert.equal(ids(sortRecords(rows, schema, [])), '4,2,3,1', 'oletus: artisti (The ohitetaan)');
  assert.equal(ids(sortRecords(rows, schema, [{ key: 'year', dir: 'asc' }])), '3,2,1,4');
  assert.equal(ids(sortRecords(rows, schema, [{ key: 'year', dir: 'desc' }])), '1,2,3,4', 'tyhjä viimeisenä myös laskevassa');
  assert.equal(ids(sortRecords(rows, schema, [{ key: 'status', dir: 'asc' }])), '3,4,1,2');
  assert.equal(ids(sortRecords(rows, schema, [{ key: 'genre', dir: 'asc' }, { key: 'purchase_price', dir: 'desc' }])), '3,1,2,4');
  assert.equal(ids(sortRecords(rows, schema, [{ key: 'created_at', dir: 'desc' }])), '4,1,3,2', 'lisäysaika');
});

test('Suodatus: arvolista, väli, sisältää ja haku yhdessä', () => {
  assert.equal(ids(applyView(rows, schema, { filters: { status: { values: ['Varastossa'] } } })), '4,1');
  assert.equal(ids(applyView(rows, schema, { filters: { genre: { values: [''] } } })), '4', 'tyhjä arvo valittavissa');
  assert.equal(ids(applyView(rows, schema, { filters: { status: { values: [] } } })), '', 'kaikki pois valittu → ei mitään');
  assert.equal(ids(applyView(rows, schema, { filters: { purchase_price: { min: '10', max: '40' } } })), '2');
  assert.equal(ids(applyView(rows, schema, { filters: { year: { min: '1960' } } })), '2,1');
  assert.equal(ids(applyView(rows, schema, { filters: { title: { contains: 'ROAD' } } })), '2');
  assert.equal(ids(applyView(rows, schema, { query: 'rock', filters: { status: { values: ['Myyty', 'Varastossa'] } }, sort: [{ key: 'year', dir: 'desc' }] })), '1,2');
  assert.equal(ids(applyView(rows, schema, { filters: { poistettu_kentta: { values: [] } } })), '4,2,3,1', 'tuntemattoman kentän suodatin ohitetaan');
  assert.ok(matchesFilter(F.purchase_date, '2021-05-01', { min: '2021-01-01', max: '2021-12-31' }));
  assert.ok(!matchesFilter(F.purchase_date, '', { min: '2021-01-01' }));
});

test('Suodatus: arvot lukumäärineen ja kuvaukset', () => {
  assert.deepEqual(valueCounts(rows, F.status), [['Tilattu', 1], ['Varastossa', 2], ['Myyty', 1]]);
  assert.deepEqual(valueCounts(rows, F.genre).at(-1), ['', 1], 'tyhjä viimeisenä');
  assert.equal(describeFilter(F.status, { values: ['Varastossa', 'Tilattu', 'Myyty'] }), 'Varastossa, Tilattu +1');
  assert.equal(describeFilter(F.purchase_price, { min: '10', max: '' }).replace(/\s/g, ' '), '≥ 10,00 €');
  assert.ok(!isActive({}));
  assert.ok(isActive({ values: [] }));
  assert.equal(activeFilterCount(schema, { status: { values: ['Myyty'] }, genre: {}, tuntematon: { values: [] } }), 1);
});
