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
