// Dropbox-tallennus selaimesta: OAuth 2 + PKCE (ei salaisuuksia sovelluksessa),
// pitkäikäinen refresh token, sovelluskansio-oikeus (App folder).

import { db } from '../db.js';

const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function redirectUri() {
  return location.origin + location.pathname;
}

// Dropbox-API-Arg -otsakkeessa ei-ASCII-merkit pitää koodata \uXXXX-muotoon.
function headerArg(obj) {
  return JSON.stringify(obj).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export const dropboxBackend = {
  id: 'dropbox',
  label: 'Dropbox',
  supported: () => true,
  settings: {},
  auth: null,

  configure(settings) { this.settings = settings; },

  get appKey() { return (this.settings.dropboxAppKey || '').trim(); },

  get root() {
    const f = (this.settings.remoteFolder || '').trim().replace(/^\/+|\/+$/g, '');
    return f ? `/${f}` : '';
  },

  async connect(interactive = false) {
    this.auth ??= await db.getMeta('dropboxAuth', null);
    if (this.auth?.refresh_token) return true;
    if (!interactive) return false;
    if (!this.appKey) throw new Error('Anna Dropboxin App key asetuksissa');

    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ));
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
    sessionStorage.setItem('dropbox_pkce', JSON.stringify({ verifier, state }));
    const params = new URLSearchParams({
      client_id: this.appKey, response_type: 'code', code_challenge: challenge,
      code_challenge_method: 'S256', redirect_uri: redirectUri(),
      token_access_type: 'offline', state,
    });
    location.assign(`${AUTH_URL}?${params}`);
    return new Promise(() => {}); // sivu siirtyy Dropboxiin
  },

  /** Käsittelee paluun Dropboxin kirjautumisesta. Palauttaa true, jos kirjautuminen onnistui. */
  async handleRedirect() {
    const url = new URL(location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const saved = JSON.parse(sessionStorage.getItem('dropbox_pkce') || 'null');
    if (!code || !saved) return false;
    sessionStorage.removeItem('dropbox_pkce');
    history.replaceState(null, '', redirectUri());
    if (state !== saved.state) throw new Error('Dropbox-kirjautuminen hylättiin (state ei täsmää)');

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({
        code, grant_type: 'authorization_code', client_id: this.appKey,
        code_verifier: saved.verifier, redirect_uri: redirectUri(),
      }),
    });
    if (!res.ok) throw new Error(`Dropbox-kirjautuminen epäonnistui (${res.status})`);
    const t = await res.json();
    this.auth = {
      refresh_token: t.refresh_token, access_token: t.access_token,
      expires_at: Date.now() + (t.expires_in - 60) * 1000,
    };
    await db.setMeta('dropboxAuth', this.auth);
    return true;
  },

  async disconnect() {
    try {
      if (this.auth) await fetch(`${API}/auth/token/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${await this.token()}` } });
    } catch { /* ei haittaa */ }
    this.auth = null;
    await db.setMeta('dropboxAuth', null);
  },

  describe() {
    return this.auth ? `Dropbox${this.root ? ` › Sovellukset › ${this.root.slice(1)}` : ' › Sovellukset'}` : 'Dropboxiin ei ole kirjauduttu';
  },

  async token() {
    if (this.auth.access_token && Date.now() < this.auth.expires_at) return this.auth.access_token;
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.auth.refresh_token, client_id: this.appKey }),
    });
    if (res.status === 400 || res.status === 401) {
      this.auth = null; await db.setMeta('dropboxAuth', null);
      throw new Error('Dropbox-kirjautuminen on vanhentunut – kirjaudu uudelleen');
    }
    if (!res.ok) throw new Error(`Dropbox ei vastaa (${res.status})`);
    const t = await res.json();
    this.auth.access_token = t.access_token;
    this.auth.expires_at = Date.now() + (t.expires_in - 60) * 1000;
    await db.setMeta('dropboxAuth', this.auth);
    return t.access_token;
  },

  async read(path) {
    const res = await fetch(`${CONTENT}/files/download`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.token()}`, 'Dropbox-API-Arg': headerArg({ path: `${this.root}/${path}` }) },
    });
    if (res.status === 409) return null; // path/not_found
    if (!res.ok) throw new Error(`Dropbox-luku epäonnistui (${res.status})`);
    return res.blob();
  },

  async write(path, blob) {
    const res = await fetch(`${CONTENT}/files/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': headerArg({ path: `${this.root}/${path}`, mode: 'overwrite', mute: true }),
      },
      body: blob,
    });
    if (!res.ok) throw new Error(`Dropbox-tallennus epäonnistui (${res.status})`);
  },

  async remove(path) {
    const res = await fetch(`${API}/files/delete_v2`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: `${this.root}/${path}` }),
    });
    if (!res.ok && res.status !== 409) throw new Error(`Dropbox-poisto epäonnistui (${res.status})`);
  },
};
