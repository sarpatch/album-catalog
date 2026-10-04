// IndexedDB-kerros: laitteen paikallinen työkopio (offline-first).
// Säilöt:
//   records – levyt (avain id)
//   covers  – kansikuvat { id, file, full: Blob, thumb: Blob, synced: { [backend]: true } }
//   meta    – asetukset ja synkronoinnin tila { key, value }

const DB_NAME = 'lp-kokoelma';
const DB_VERSION = 1;
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('covers')) db.createObjectStore('covers', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Tallennus keskeytyi'));
  });
}

export const db = {
  async allRecords() {
    return tx(['records'], 'readonly', (t) => promisify(t.objectStore('records').getAll()));
  },
  async putRecords(list) {
    if (!list.length) return;
    return tx(['records'], 'readwrite', (t) => {
      const s = t.objectStore('records');
      for (const r of list) s.put(r);
    });
  },
  async deleteRecords(ids) {
    if (!ids.length) return;
    return tx(['records', 'covers'], 'readwrite', (t) => {
      for (const id of ids) {
        t.objectStore('records').delete(id);
        t.objectStore('covers').delete(id);
      }
    });
  },
  async replaceAll(records) {
    return tx(['records'], 'readwrite', (t) => {
      const s = t.objectStore('records');
      s.clear();
      for (const r of records) s.put(r);
    });
  },

  async getCover(id) {
    return tx(['covers'], 'readonly', (t) => promisify(t.objectStore('covers').get(id)));
  },
  async allCovers() {
    return tx(['covers'], 'readonly', (t) => promisify(t.objectStore('covers').getAll()));
  },
  async putCover(cover) {
    return tx(['covers'], 'readwrite', (t) => { t.objectStore('covers').put(cover); });
  },
  async deleteCover(id) {
    return tx(['covers'], 'readwrite', (t) => { t.objectStore('covers').delete(id); });
  },

  async getMeta(key, fallback = undefined) {
    const row = await tx(['meta'], 'readonly', (t) => promisify(t.objectStore('meta').get(key)));
    return row ? row.value : fallback;
  },
  async setMeta(key, value) {
    return tx(['meta'], 'readwrite', (t) => { t.objectStore('meta').put({ key, value }); });
  },
};

/** Pyytää selainta olemaan poistamatta tietoja tilan loppuessa. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      return await navigator.storage.persist();
    }
    return true;
  } catch {
    return false;
  }
}
