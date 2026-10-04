// Google Drive -tallennus: Google Identity Services (token-malli) + Drive API v3.
// Käyttää suppeinta mahdollista oikeutta (drive.file): sovellus näkee vain itse
// luomansa tiedostot, ei muuta Driven sisältöä.

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const TOKEN_KEY = 'gdrive_token';

let gisPromise;
function loadGis() {
  gisPromise ??= new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = GIS_SRC; s.async = true;
    s.onload = resolve;
    s.onerror = () => { gisPromise = null; reject(new Error('Googlen kirjautumista ei voitu ladata (verkko?)')); };
    document.head.append(s);
  });
  return gisPromise;
}

const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export const gdriveBackend = {
  id: 'gdrive',
  label: 'Google Drive',
  supported: () => true,
  settings: {},
  token: null,
  ids: new Map(), // polku → Drive-tunniste (istunnon välimuisti)

  configure(settings) { this.settings = settings; },

  get clientId() { return (this.settings.googleClientId || '').trim(); },
  get rootName() { return (this.settings.remoteFolder || '').trim() || 'LP-kokoelma'; },

  validToken() {
    if (!this.token) {
      try { this.token = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); } catch { /* */ }
    }
    return this.token && Date.now() < this.token.expires_at ? this.token.access_token : null;
  },

  async connect(interactive = false) {
    if (this.validToken()) return true;
    if (!interactive) return false;
    if (!this.clientId) throw new Error('Anna Googlen OAuth Client ID asetuksissa');
    await loadGis();
    const resp = await new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPE,
        callback: resolve,
        error_callback: (e) => reject(new Error(e?.message || 'Google-kirjautuminen peruttiin')),
      });
      client.requestAccessToken({ prompt: localStorage.getItem('gdrive_consented') ? '' : 'consent' });
    });
    if (resp.error) throw new Error(`Google-kirjautuminen epäonnistui: ${resp.error}`);
    localStorage.setItem('gdrive_consented', '1');
    this.token = { access_token: resp.access_token, expires_at: Date.now() + (Number(resp.expires_in) - 60) * 1000 };
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(this.token));
    return true;
  },

  async disconnect() {
    const t = this.validToken();
    if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t, () => {});
    this.token = null; this.ids.clear();
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('gdrive_consented');
  },

  describe() {
    return this.validToken() ? `Google Drive › ${this.rootName}` : 'Googleen ei ole kirjauduttu (istunto vanhenee tunnissa)';
  },

  async api(url, opts = {}) {
    const token = this.validToken();
    if (!token) throw Object.assign(new Error('Kirjaudu uudelleen Google Driveen'), { needsLogin: true });
    const res = await fetch(url, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      this.token = null; sessionStorage.removeItem(TOKEN_KEY);
      throw Object.assign(new Error('Google-istunto vanheni – kirjaudu uudelleen'), { needsLogin: true });
    }
    return res;
  },

  async find(name, parentId, mime) {
    let query = `name='${q(name)}' and '${parentId}' in parents and trashed=false`;
    if (mime) query += ` and mimeType='${mime}'`;
    const res = await this.api(`${API}/files?${new URLSearchParams({ q: query, fields: 'files(id)', spaces: 'drive' })}`);
    if (!res.ok) throw new Error(`Drive-haku epäonnistui (${res.status})`);
    return (await res.json()).files[0]?.id ?? null;
  },

  async folderId(path, create) {
    if (this.ids.has(path)) return this.ids.get(path);
    const parts = path.split('/');
    const parent = parts.length > 1 ? await this.folderId(parts.slice(0, -1).join('/'), create) : 'root';
    if (!parent) return null;
    let id = await this.find(parts.at(-1), parent, FOLDER_MIME);
    if (!id && create) {
      const res = await this.api(`${API}/files?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: parts.at(-1), mimeType: FOLDER_MIME, parents: [parent] }),
      });
      if (!res.ok) throw new Error(`Drive-kansion luonti epäonnistui (${res.status})`);
      id = (await res.json()).id;
    }
    if (id) this.ids.set(path, id);
    return id;
  },

  split(path) {
    const parts = `${this.rootName}/${path}`.split('/');
    return { dir: parts.slice(0, -1).join('/'), name: parts.at(-1) };
  },

  async fileId(path, create) {
    const { dir, name } = this.split(path);
    const parent = await this.folderId(dir, create);
    return { parent, id: parent ? await this.find(name, parent) : null, name };
  },

  async read(path) {
    const { id } = await this.fileId(path, false);
    if (!id) return null;
    const res = await this.api(`${API}/files/${id}?alt=media`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Drive-luku epäonnistui (${res.status})`);
    return res.blob();
  },

  async write(path, blob) {
    const { parent, id, name } = await this.fileId(path, true);
    let res;
    if (id) {
      res = await this.api(`${UPLOAD}/files/${id}?uploadType=media`, { method: 'PATCH', body: blob });
    } else {
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify({ name, parents: [parent] })], { type: 'application/json' }));
      form.append('file', blob);
      res = await this.api(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', body: form });
    }
    if (!res.ok) throw new Error(`Drive-tallennus epäonnistui (${res.status})`);
  },

  async remove(path) {
    const { id } = await this.fileId(path, false);
    if (!id) return;
    const res = await this.api(`${API}/files/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Drive-poisto epäonnistui (${res.status})`);
  },
};
