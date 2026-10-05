// Synkronointi: laitteen IndexedDB ⇄ valittu tallennuspaikka.
// Tallennuspaikassa: kokoelma.csv (levyt), kentat.json (kenttämäärittely), kannet/ (kuvat).

import { parseCSVObjects, toCSV } from './csv.js';
import { csvColumns, parseSchema, schemaToJSON, SCHEMA_FILE } from './schema.js';
import { fromImportRow, mapHeaders } from './model.js';
import { sortRecords } from './query.js';
import { threeWayMerge } from './merge.js';

export const CSV_NAME = 'kokoelma.csv';

/**
 * Jäsentää tallennuspaikan CSV:n. Sovelluksen kirjoittamat rivit (id + updated_at)
 * säilytetään merkki merkiltä, jotta synkronointi ei tee turhia muutoksia.
 * Käsin lisätyt rivit (ilman id:tä) siistitään ja saavat id:n.
 */
export function recordsFromCSV(text, schema) {
  const { headers, records } = parseCSVObjects(text);
  const { mapping } = mapHeaders(schema, headers);
  let addedIds = false;
  const out = [];
  for (const row of records) {
    if (row.id && row.updated_at) {
      const r = {};
      for (const [k, v] of Object.entries(row)) if (k) r[k] = v;
      out.push(r);
    } else {
      const r = fromImportRow(schema, row, mapping);
      if (r) { out.push(r); addedIds = true; }
    }
  }
  return { records: out, addedIds };
}

export function recordsToCSV(records, schema) {
  return toCSV(csvColumns(schema, records), sortRecords(records, schema, []));
}

export class SyncEngine {
  /**
   * @param {object} deps
   * @param {object} deps.store        tallennusrajapinta (db.js:n muotoinen)
   * @param {(blob: Blob) => Promise<Blob>} deps.makeThumb
   * @param {() => object} deps.getSchema
   * @param {(schema: object) => Promise<void>} deps.setSchema
   * @param {(status: object) => void} [deps.onStatus]
   */
  constructor({ store, makeThumb, getSchema, setSchema, onStatus = () => {} }) {
    Object.assign(this, { store, makeThumb, getSchema, setSchema, onStatus });
    this.backend = null;
    this.running = null;
    this.again = false;
    this.status = { state: 'local' };
  }

  setBackend(backend, settings = {}) {
    this.backend = backend;
    this.key = `${backend.id}|${(settings.remoteFolder || '').trim()}`;
    this.emit(backend.id === 'local' ? { state: 'local' } : { state: 'idle' });
  }

  emit(status) {
    this.status = status;
    this.onStatus(status);
  }

  async queueRemoteDelete(path) {
    if (!path || this.backend?.id === 'local') return;
    const k = `pendingDeletes:${this.key}`;
    const list = await this.store.getMeta(k, []);
    if (!list.includes(path)) list.push(path);
    await this.store.setMeta(k, list);
  }

  /** Ajaa synkronoinnin. Päällekkäiset kutsut yhdistetään. */
  sync(opts = {}) {
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      let result;
      try {
        do {
          this.again = false;
          result = await this.runOnce(opts);
          opts = { ...opts, interactive: false };
        } while (this.again);
      } finally {
        this.running = null;
      }
      return result;
    })();
    return this.running;
  }

  /**
   * Kenttämäärittelyn synkronointi. Muistaa viimeksi synkronoidun tekstin, jotta
   * tunnistetaan, kumpi puoli on muuttunut. Jos molemmat, tallennuspaikan versio
   * voittaa (käsin tehty muokkaus on tarkoituksellinen).
   */
  async syncSchema(b) {
    const metaKey = `schemaBase:${this.key}`;
    const base = await this.store.getMeta(metaKey, {});
    const localText = schemaToJSON(this.getSchema());
    const blob = await b.read(SCHEMA_FILE);
    if (blob) {
      const remoteText = await blob.text();
      if (remoteText !== base.remote) {
        let parsed;
        try {
          parsed = parseSchema(remoteText);
        } catch (e) {
          return { error: e.message }; // ei korvata käyttäjän rikkinäistä tiedostoa
        }
        if (schemaToJSON(parsed.schema) !== localText) {
          await this.setSchema(parsed.schema);
          await this.store.setMeta(metaKey, { remote: remoteText, local: schemaToJSON(parsed.schema) });
          return { changed: true, warnings: parsed.warnings };
        }
        await this.store.setMeta(metaKey, { remote: remoteText, local: localText });
        return { warnings: parsed.warnings };
      }
      if (localText === base.local) return {};
    }
    await b.write(SCHEMA_FILE, new Blob([localText], { type: 'application/json' }));
    await this.store.setMeta(metaKey, { remote: localText, local: localText });
    return {};
  }

  async runOnce({ interactive = false } = {}) {
    const b = this.backend;
    if (!b || b.id === 'local') { this.emit({ state: 'local' }); return { changed: false }; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.emit({ state: 'offline' }); return { changed: false };
    }
    try {
      if (!(await b.connect(interactive))) { this.emit({ state: 'login' }); return { changed: false }; }
      this.emit({ state: 'syncing' });

      const schemaResult = await this.syncSchema(b);
      const schema = this.getSchema();

      const remoteBlob = await b.read(CSV_NAME);
      const remote = remoteBlob ? recordsFromCSV(await remoteBlob.text(), schema) : { records: [], addedIds: false };
      const baseKey = `syncBase:${this.key}`;
      const base = await this.store.getMeta(baseKey, {});
      const local = await this.store.allRecords();

      const m = threeWayMerge(local, remote.records, base);
      await this.store.putRecords(m.localUpserts);
      await this.store.deleteRecords(m.localDeletes);

      // Kansikuvat
      let coversChanged = 0;
      for (const r of m.merged) {
        const c = await this.store.getCover(r.id);
        if (r.cover_file) {
          if (!c || c.file !== r.cover_file) {
            const full = await b.read(r.cover_file);
            if (full) {
              await this.store.putCover({ id: r.id, file: r.cover_file, full, thumb: await this.makeThumb(full), synced: { [this.key]: true } });
              coversChanged++;
            }
          } else if (!c.synced?.[this.key]) {
            await b.write(r.cover_file, c.full);
            await this.store.putCover({ ...c, synced: { ...c.synced, [this.key]: true } });
          }
        } else if (c) {
          await this.store.deleteCover(r.id);
          coversChanged++;
        }
      }

      const delKey = `pendingDeletes:${this.key}`;
      const pending = await this.store.getMeta(delKey, []);
      const stillUsed = new Set(m.merged.map((r) => r.cover_file));
      for (const path of pending) if (!stillUsed.has(path)) await b.remove(path);
      if (pending.length) await this.store.setMeta(delKey, []);

      if (m.remoteChanged || remote.addedIds || !remoteBlob) {
        await b.write(CSV_NAME, new Blob([recordsToCSV(m.merged, schema)], { type: 'text/csv;charset=utf-8' }));
      }
      await this.store.setMeta(baseKey, m.newBase);
      const at = new Date().toISOString();
      await this.store.setMeta('lastSyncAt', at);
      this.emit({ state: 'ok', at });
      return {
        changed: m.localUpserts.length > 0 || m.localDeletes.length > 0 || coversChanged > 0 || !!schemaResult.changed,
        schema: schemaResult,
        merge: m,
      };
    } catch (e) {
      console.error('Synkronointi epäonnistui', e);
      this.emit(e.needsLogin ? { state: 'login', message: e.message } : { state: 'error', message: e.message });
      return { changed: false, error: e };
    }
  }
}
