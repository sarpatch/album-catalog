// Synkronointi: laitteen IndexedDB ⇄ valittu tallennuspaikka (kokoelma.csv + kannet/).

import { parseCSVObjects, toCSV } from './csv.js';
import { FIELDS, fromImportRow, normalizeRecord, SORTS } from './model.js';
import { threeWayMerge } from './merge.js';

export const CSV_NAME = 'kokoelma.csv';

/** Jäsentää pilven CSV:n levyiksi. Käsin lisätyt rivit (ilman id:tä) saavat id:n. */
export function recordsFromCSV(text) {
  const { records } = parseCSVObjects(text);
  let addedIds = false;
  const out = [];
  for (const row of records) {
    if (row.id && row.updated_at) {
      const r = normalizeRecord(row);
      r.id = row.id; r.created_at = row.created_at || row.updated_at; r.updated_at = row.updated_at;
      out.push(r);
    } else {
      const r = fromImportRow(row);
      if (r) { out.push(r); addedIds = true; }
    }
  }
  return { records: out, addedIds };
}

export function recordsToCSV(records) {
  return toCSV(FIELDS, [...records].sort(SORTS.artist.cmp));
}

export class SyncEngine {
  /**
   * @param {object} deps
   * @param {object} deps.store   tallennusrajapinta (db.js:n muotoinen)
   * @param {(blob: Blob) => Promise<Blob>} deps.makeThumb
   * @param {(status: object) => void} [deps.onStatus]
   */
  constructor({ store, makeThumb, onStatus = () => {} }) {
    this.store = store;
    this.makeThumb = makeThumb;
    this.onStatus = onStatus;
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

  async runOnce({ interactive = false } = {}) {
    const b = this.backend;
    if (!b || b.id === 'local') { this.emit({ state: 'local' }); return { changed: false }; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.emit({ state: 'offline' }); return { changed: false };
    }
    try {
      if (!(await b.connect(interactive))) { this.emit({ state: 'login' }); return { changed: false }; }
      this.emit({ state: 'syncing' });

      const remoteBlob = await b.read(CSV_NAME);
      const remote = remoteBlob ? recordsFromCSV(await remoteBlob.text()) : { records: [], addedIds: false };
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
        await b.write(CSV_NAME, new Blob([recordsToCSV(m.merged)], { type: 'text/csv;charset=utf-8' }));
      }
      await this.store.setMeta(baseKey, m.newBase);
      const at = new Date().toISOString();
      await this.store.setMeta('lastSyncAt', at);
      this.emit({ state: 'ok', at });
      return {
        changed: m.localUpserts.length > 0 || m.localDeletes.length > 0 || coversChanged > 0,
        merge: m,
      };
    } catch (e) {
      console.error('Synkronointi epäonnistui', e);
      this.emit(e.needsLogin ? { state: 'login', message: e.message } : { state: 'error', message: e.message });
      return { changed: false, error: e };
    }
  }
}
