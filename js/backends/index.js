// Tallennuspaikkojen rekisteri. Uuden paikan lisääminen: tee olio, jolla on
// id, label, supported(), connect(interactive), disconnect(), describe(),
// read(path) → Blob|null, write(path, blob), remove(path) – ja lisää se tähän.

import { folderBackend } from './folder.js';
import { dropboxBackend } from './dropbox.js';
import { gdriveBackend } from './gdrive.js';

export const localBackend = {
  id: 'local',
  label: 'Vain tämä laite',
  supported: () => true,
  async connect() { return true; },
  async disconnect() {},
  describe() { return 'Tiedot ovat vain tämän selaimen muistissa'; },
};

export const BACKENDS = [localBackend, dropboxBackend, gdriveBackend, folderBackend];

export function getBackend(id, settings) {
  const b = BACKENDS.find((x) => x.id === id) ?? localBackend;
  b.configure?.(settings);
  return b;
}
