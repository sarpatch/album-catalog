// Tallennus paikalliseen kansioon (File System Access API, Chrome/Edge läppärillä).
// Kansioksi voi valita myös Dropboxin tai Google Driven työpöytäsovelluksen kansion.

import { db } from '../db.js';

export const folderBackend = {
  id: 'folder',
  label: 'Kansio tällä tietokoneella',
  supported: () => typeof window !== 'undefined' && 'showDirectoryPicker' in window,
  handle: null,

  async connect(interactive = false) {
    this.handle ??= await db.getMeta('folderHandle', null);
    if (this.handle) {
      const opts = { mode: 'readwrite' };
      if ((await this.handle.queryPermission(opts)) === 'granted') return true;
      if (interactive && (await this.handle.requestPermission(opts)) === 'granted') return true;
      if (!interactive) return false;
    }
    if (!interactive) return false;
    this.handle = await window.showDirectoryPicker({ id: 'lp-kokoelma', mode: 'readwrite' });
    await db.setMeta('folderHandle', this.handle);
    return true;
  },

  async disconnect() {
    this.handle = null;
    await db.setMeta('folderHandle', null);
  },

  describe() {
    return this.handle ? `Kansio: ${this.handle.name}` : 'Kansiota ei ole valittu';
  },

  async dirFor(path, create) {
    const parts = path.split('/');
    let dir = this.handle;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create });
    return { dir, name: parts.at(-1) };
  },

  async read(path) {
    try {
      const { dir, name } = await this.dirFor(path, false);
      return await (await dir.getFileHandle(name)).getFile();
    } catch (e) {
      if (e.name === 'NotFoundError') return null;
      throw e;
    }
  },

  async write(path, blob) {
    const { dir, name } = await this.dirFor(path, true);
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable(); // kirjoitetaan väliaikaistiedostoon → atominen vaihto
    await w.write(blob);
    await w.close();
  },

  async remove(path) {
    try {
      const { dir, name } = await this.dirFor(path, false);
      await dir.removeEntry(name);
    } catch (e) {
      if (e.name !== 'NotFoundError') throw e;
    }
  },
};
