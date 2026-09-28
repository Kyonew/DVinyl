import fs from 'fs';
import path from 'path';

const AVATARS_DIR = path.join(__dirname, '../../public/uploads/avatars');

/** Removes any avatar file a test produced for one user (`avatar-<userId>-*`). */
export function removeAvatarFiles(userId: any): void {
  const prefix = `avatar-${String(userId)}-`;
  if (!fs.existsSync(AVATARS_DIR)) return;
  for (const name of fs.readdirSync(AVATARS_DIR)) {
    if (name.startsWith(prefix)) {
      try {
        fs.unlinkSync(path.join(AVATARS_DIR, name));
      } catch {
        // best-effort cleanup; a missing file is not a test failure
      }
    }
  }
}

const PUBLIC_DIR = path.join(__dirname, '../../public');

/** Removes managed item-image files by the URL `storeItemImage()` returned. */
export function removeItemImageUrls(urls: string[]): void {
  for (const url of urls) {
    if (!url) continue;
    try {
      fs.unlinkSync(path.join(PUBLIC_DIR, url.replace(/^\/+/, '')));
    } catch {
      // best-effort cleanup; a missing file is not a test failure
    }
  }
}
