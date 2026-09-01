import fs from 'fs';
import path from 'path';
import { BASE_URL } from '../../config/constants';

/**
 * YGOPRODeck's usage policy explicitly forbids hotlinking card images ("download and
 * re-host, or risk an IP blacklist" — which would affect every DVinyl install sharing
 * that policy's IP range, not just one user). Every other plugin stores the remote
 * cover URL directly; this one downloads once and serves the local copy instead,
 * reusing `public/uploads/` — already this app's convention for dynamically-written,
 * gitignored files (see `public/uploads/avatars/`) and already served statically by
 * the `express.static(path.join(__dirname, 'public'))` mount in app.ts. No new route.
 */
const CACHE_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'yugioh-cards');

function ensureCacheDir(): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Downloads `remoteUrl` into the local cache under `cardId` if not already present,
 * and returns the local, same-origin path to use as `cover_image`. Never re-downloads
 * an existing file — a second add or refresh of the same card is a filesystem check.
 */
export async function cacheYugiohImage(cardId: string, remoteUrl: string): Promise<string> {
  if (!remoteUrl) return '';
  ensureCacheDir();
  const localPath = path.join(CACHE_DIR, `${cardId}.jpg`);
  const publicPath = `${BASE_URL}/uploads/yugioh-cards/${cardId}.jpg`;

  if (fs.existsSync(localPath)) return publicPath;

  const response = await fetch(remoteUrl);
  if (!response.ok) return remoteUrl; // fall back to the remote URL rather than fail the add
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(localPath, buffer);
  return publicPath;
}
