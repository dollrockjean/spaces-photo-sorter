// Settings you may need to change. Nothing here is secret.
export const config = {
  // From Google Cloud Console (APIs & Services > Credentials > OAuth client ID > Web application).
  // Leave empty until that is set up. The page then offers the demo instead of Google sign-in.
  CLIENT_ID: '490937536224-pokl5nei6ftm135ngjid9deeiqd61tec.apps.googleusercontent.com',

  // "SDH Project Photos" in Drive.
  ROOT_FOLDER_ID: '15hW6ZvxgX3vf-trquAI2CWtB-wH3xFmw',

  // Folder the tool opens first: "Pictures To Sort".
  START_FOLDER_ID: '1k0iYbiBgSEcG-V0A1MTnl9NKX5C36srG',

  // Construction photos go here, inside the root folder.
  UNFINISHED_NAME: 'Unfinished Projects',

  // High-quality print versions go here, inside the root folder, organized the same way.
  PRINTS_NAME: 'Prints',

  // Folders in the root that are not client-house folders.
  NOT_CLIENTS: ['Unfinished Projects', 'Pictures To Sort', 'ZIPS', 'Prints'],
  NOT_CLIENT_PREFIX: 'PLACEHOLDER',
};
