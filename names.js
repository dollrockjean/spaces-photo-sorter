// Folder and file naming rules, taken from the Spaces "Photo Library Organization" SOP.
// Pure functions only, so they can be tested without a browser.

export const GROUPS = {
  Exterior: [
    { folder: 'Full Front (Front Elevation)', token: 'FullFront' },
    { folder: 'Front Door Entrance – Exterior', token: 'ExtFrontEntrance' },
    { folder: 'Other Angles, Sides, Back', token: 'OtherAngles' },
  ],
  Aerial: [
    { folder: 'Aerial Photos', token: 'Aerial' },
    { folder: 'Drone Video', token: 'DroneVideo' },
  ],
  Interior: [
    { folder: 'Interior (Foyer)', token: 'IntFrontEntrance' },
    { folder: 'Mudroom', token: 'Mudroom' },
    { folder: 'Kitchen', token: 'Kitchen' },
    { folder: 'Master Bath', token: 'MasterBath' },
    { folder: 'Secondary Baths', token: 'SecondaryBaths' },
    { folder: 'Living Areas', token: 'LivingAreas' },
    { folder: 'Bedrooms', token: 'Bedrooms' },
    { folder: 'Other', token: 'Other' },
  ],
};

export const PROJECT_TYPES = ['Main House', 'Cottage', 'Pool House', 'Remodel'];

const alnum = (s) => s.replace(/[^\p{L}\p{N}]/gu, '');

// "Jachowicz – 123 Main St, Pullman MI" -> "Jachowicz"
export function clientToken(folderName) {
  const name = folderName.split(/\s[–—-]\s/)[0];
  return alnum(name);
}

// "Main House" -> "MainHouse"
export function typeToken(projectType) {
  return alnum(projectType);
}

export function clientFolderName(name, address) {
  return `${name.trim()} – ${address.trim()}`;
}

export function extOf(fileName) {
  const i = fileName.lastIndexOf('.');
  return i > 0 ? fileName.slice(i + 1).toLowerCase() : '';
}

export function prefixFor(clientFolder, projectType, categoryToken) {
  return `${clientToken(clientFolder)}_${typeToken(projectType)}_${categoryToken}`;
}

export function buildName(prefix, n, ext) {
  const num = String(n).padStart(2, '0');
  return ext ? `${prefix}_${num}.${ext}` : `${prefix}_${num}`;
}

// Next free number for a prefix, given the names already in the folder.
export function nextNumber(existingNames, prefix) {
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)(\\.|$)`);
  let max = 0;
  for (const name of existingNames) {
    const m = re.exec(name);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

export function findCategory(group, folder) {
  return GROUPS[group].find((c) => c.folder === folder);
}
