// Real Google Drive backend: Google sign-in plus the Drive v3 REST API.
import { config } from './config.js';

const API = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const SCOPE = 'https://www.googleapis.com/auth/drive';
const COMMON = 'supportsAllDrives=true&includeItemsFromAllDrives=true';

const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google sign-in. Check the internet connection.'));
    document.head.appendChild(s);
  });
}

export function createDriveBackend() {
  let token = null;
  let tokenClient = null;
  let pending = null;

  function requestToken(prompt) {
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      tokenClient.requestAccessToken({ prompt });
    });
  }

  async function api(path, opts = {}, retry = true) {
    const res = await fetch(path.startsWith('http') ? path : API + path, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    if (res.status === 401 && retry) {
      await requestToken('');
      return api(path, opts, false);
    }
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).error.message; } catch { /* keep statusText */ }
      throw new Error(`Google Drive said: ${msg}`);
    }
    return res.status === 204 ? null : res.json();
  }

  async function listAll(query, fields) {
    const out = [];
    let pageToken = '';
    do {
      const url = `/files?q=${encodeURIComponent(query)}&fields=nextPageToken,files(${fields})&pageSize=1000&orderBy=name_natural&${COMMON}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const page = await api(url);
      out.push(...page.files);
      pageToken = page.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  return {
    async signIn() {
      await loadGis();
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: config.CLIENT_ID,
        scope: SCOPE,
        callback: (resp) => {
          if (resp.error) pending?.reject(new Error(resp.error_description || resp.error));
          else { token = resp.access_token; pending?.resolve(); }
        },
        error_callback: (err) => pending?.reject(new Error(err.message || 'Sign-in was cancelled.')),
      });
      await requestToken('select_account');
      const about = await api('/about?fields=user(emailAddress)');
      return { email: about.user.emailAddress };
    },

    signOut() {
      if (token) google.accounts.oauth2.revoke(token);
      token = null;
    },

    async folderInfo(id) {
      const f = await api(`/files/${id}?fields=id,name,parents&supportsAllDrives=true`);
      return { id: f.id, name: f.name, parent: f.parents?.[0] || null };
    },

    async listFolder(id) {
      const items = await listAll(
        `'${q(id)}' in parents and trashed=false`,
        'id,name,mimeType,thumbnailLink',
      );
      const folders = items.filter((f) => f.mimeType === FOLDER).map((f) => ({ id: f.id, name: f.name }));
      const files = items
        .filter((f) => f.mimeType !== FOLDER && (f.mimeType.startsWith('image/') || f.mimeType.startsWith('video/')))
        .map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          parent: id,
          thumb: f.thumbnailLink ? f.thumbnailLink.replace(/=s\d+$/, '=s320') : null,
        }));
      return { folders, files };
    },

    async findChild(parentId, name) {
      const hits = await listAll(
        `'${q(parentId)}' in parents and name='${q(name)}' and mimeType='${FOLDER}' and trashed=false`,
        'id,name',
      );
      return hits[0]?.id || null;
    },

    async ensureFolder(parentId, name) {
      const found = await this.findChild(parentId, name);
      if (found) return found;
      const created = await api(`/files?fields=id&supportsAllDrives=true`, {
        method: 'POST',
        body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
      });
      return created.id;
    },

    async moveFile(id, fromParent, toParent, newName) {
      await api(`/files/${id}?addParents=${encodeURIComponent(toParent)}&removeParents=${encodeURIComponent(fromParent)}&supportsAllDrives=true&fields=id`, {
        method: 'PATCH',
        body: JSON.stringify({ name: newName }),
      });
    },
  };
}
