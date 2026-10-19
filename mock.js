// Demo backend: a fake Drive in memory, so the tool can be tried and tested without signing in.
// Uses the same ids as config.js so the app code does not know the difference.
import { config } from './config.js';

const delay = (ms = 40) => new Promise((r) => setTimeout(r, ms));

function thumb(label, hue) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},28%,62%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},32%,38%)"/></linearGradient></defs><rect width="320" height="240" fill="url(#g)"/><text x="160" y="128" font-family="sans-serif" font-size="22" fill="rgba(255,255,255,.85)" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function createMockBackend() {
  const nodes = new Map();
  let seq = 1000;
  const add = (id, name, parent, extra = {}) => nodes.set(id, { id, name, parent, ...extra });
  const addFolder = (name, parent, id = `f${++seq}`) => (add(id, name, parent, { folder: true }), id);
  const addFile = (name, parent, hue) => {
    const id = `p${++seq}`;
    const video = name.toLowerCase().endsWith('.mp4');
    add(id, name, parent, { mimeType: video ? 'video/mp4' : 'image/jpeg', thumb: thumb(name, hue) });
    return id;
  };

  const root = config.ROOT_FOLDER_ID;
  add(root, 'SDH Project Photos', null, { folder: true });
  const unfinished = addFolder(config.UNFINISHED_NAME, root);
  const toSort = addFolder('Pictures To Sort', root, config.START_FOLDER_ID);
  addFolder('ZIPS', root);
  addFolder('Prints', root);
  addFolder('PLACEHOLDER - Client Name – Address', root);

  const jach = addFolder('Jachowicz – 123 Main St, Pullman MI', root);
  const jachMain = addFolder('Main House', jach);
  const jachInt = addFolder('Interior', jachMain);
  const jachKitchen = addFolder('Kitchen', jachInt);
  addFile('Jachowicz_MainHouse_Kitchen_01.jpg', jachKitchen, 30);
  addFile('Jachowicz_MainHouse_Kitchen_02.jpg', jachKitchen, 40);
  addFolder('Smith – 45 Lake Rd, Saugatuck MI', root);

  addFolder('CONLEY PROJECT', unfinished);
  addFolder('SHARPE PROJECT', unfinished);

  const patrick = addFolder('Patrick (Photos to Sort)', toSort);
  const rooms = ['kitchen', 'bath', 'front', 'aerial', 'bed', 'living'];
  for (let i = 0; i < 18; i += 1) {
    addFile(`IMG_${4001 + i}.${i === 16 ? 'JPG' : 'jpg'}`, patrick, (i * 47) % 360);
  }
  addFile('DJI_0231.MP4', patrick, 200);
  const pool = addFolder('Pool house - Print Photos', toSort);
  for (let i = 0; i < 4; i += 1) addFile(`PRINT_${7001 + i}.jpg`, pool, 300 + i * 15);
  const ottawa = addFolder('2099 Ottawa Beach Road - Collection', toSort);
  for (let i = 0; i < 6; i += 1) addFile(`${rooms[i]}-${i + 1}.jpg`, ottawa, 120 + i * 20);

  return {
    mock: true,
    nodes,
    async signIn() { await delay(); return { email: 'demo@spacesdh.example' }; },
    signOut() {},
    async folderInfo(id) {
      const n = nodes.get(id);
      return { id, name: n.name, parent: n.parent };
    },
    async listFolder(id) {
      await delay();
      const kids = [...nodes.values()].filter((n) => n.parent === id);
      return {
        folders: kids.filter((n) => n.folder).map(({ id: i, name }) => ({ id: i, name })),
        files: kids.filter((n) => !n.folder).map((n) => ({
          id: n.id, name: n.name, mimeType: n.mimeType, parent: id, thumb: n.thumb,
        })),
      };
    },
    async findChild(parentId, name) {
      await delay(10);
      return [...nodes.values()].find((n) => n.folder && n.parent === parentId && n.name === name)?.id || null;
    },
    async ensureFolder(parentId, name) {
      const found = await this.findChild(parentId, name);
      return found || addFolder(name, parentId);
    },
    async moveFile(id, fromParent, toParent, newName) {
      await delay(20);
      const n = nodes.get(id);
      if (!n || n.parent !== fromParent) throw new Error('Google Drive said: File not found.');
      n.parent = toParent;
      n.name = newName;
    },
  };
}
