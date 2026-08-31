import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';
import type { Response } from 'express';
import { ZipFile as OutputZipFile } from 'yazl';
import { Entry, openPromise, ZipFile as InputZipFile } from 'yauzl';
import {
  deleteUnusedManagedItemImages,
  isJpegBuffer,
  managedItemImageFile,
  managedItemImagesFrom,
  storeItemImage
} from './itemImageStorage';

export const MAX_BACKUP_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_BACKUP_JSON_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVED_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BACKUP_UNCOMPRESSED_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_BACKUP_ENTRIES = 500_001;
const ARCHIVE_IMAGE = /^images\/(item-[0-9a-f-]{36}\.jpg)$/i;

interface ImportedBackupArchive {
  data: any;
  importedImages: string[];
}

function backupImages(data: any): string[] {
  const albums = Array.isArray(data?.albums) ? data.albums : [];
  const images: string[] = albums.flatMap((album: any) => managedItemImagesFrom(album));
  return [...new Set<string>(images)];
}

function backupImageValues(data: any): string[] {
  const albums = Array.isArray(data?.albums) ? data.albums : [];
  return albums.flatMap((album: any) => [
    album?.cover_image,
    album?.user_image,
    ...(Array.isArray(album?.images) ? album.images : [])
  ]).filter((image: unknown): image is string => typeof image === 'string' && image.length > 0);
}

function cloneForArchive(data: any): any {
  // The archive is JSON by definition. Cloning through JSON also gives ObjectIds and dates
  // exactly the representation they have always had in the historical .json export.
  return JSON.parse(JSON.stringify(data));
}

function legacyInlineJpeg(image: string): Buffer | null {
  const match = /^data:image\/jpeg;base64,([a-z0-9+/=\r\n]+)$/i.exec(image);
  if (!match) return null;
  const buffer = Buffer.from(match[1]!.replace(/\s/g, ''), 'base64');
  return buffer.length <= MAX_ARCHIVED_IMAGE_BYTES && isJpegBuffer(buffer) ? buffer : null;
}

function rewriteBackupImages(data: any, replacements: Map<string, string>): void {
  if (!Array.isArray(data?.albums) || replacements.size === 0) return;
  const replace = (value: unknown) => typeof value === 'string'
    ? (replacements.get(value) || value)
    : value;

  for (const album of data.albums) {
    album.cover_image = replace(album.cover_image);
    album.user_image = replace(album.user_image);
    if (Array.isArray(album.images)) album.images = album.images.map(replace);
  }
}

async function readEntryBuffer(zip: InputZipFile, entry: Entry, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  const stream = await zip.openReadStreamPromise(entry);

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      stream.destroy();
      throw new Error('backup_entry_too_large');
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks, total);
}

/** Streams a portable backup containing the historical JSON plus referenced local files. */
export async function sendBackupArchive(
  res: Response,
  data: any,
  fileName: string
): Promise<void> {
  const archivedData = cloneForArchive(data);
  const available: Array<{ image: string; file: string; filename: string }> = [];
  const inline: Array<{ image: string; buffer: Buffer; filename: string }> = [];
  const missing: string[] = [];

  for (const image of backupImages(archivedData)) {
    const file = managedItemImageFile(image);
    if (!file) continue;
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) throw new Error('not_a_file');
      available.push({ image, file, filename: path.basename(file) });
    } catch {
      missing.push(image);
    }
  }

  // Before item uploads were stored as files, DVinyl saved them as JPEG data URLs in
  // MongoDB. Move those legacy values into the ZIP too. The live database is untouched;
  // only backup.json is rewritten, so restoring the archive also performs the migration.
  const inlineReplacements = new Map<string, string>();
  const usedImages = new Set(backupImages(archivedData));
  for (const image of [...new Set(backupImageValues(archivedData))]) {
    const buffer = legacyInlineJpeg(image);
    if (!buffer) continue;
    let filename: string;
    let portablePath: string;
    do {
      filename = `item-${crypto.randomUUID()}.jpg`;
      portablePath = `/uploads/items/${filename}`;
    } while (usedImages.has(portablePath));
    usedImages.add(portablePath);
    inline.push({ image: portablePath, buffer, filename });
    inlineReplacements.set(image, portablePath);
  }
  rewriteBackupImages(archivedData, inlineReplacements);

  archivedData.metadata = {
      ...(archivedData?.metadata || {}),
      imageArchive: {
        version: 1,
        included: available.length + inline.length,
        legacyInlineImages: inline.length,
        missing
      }
  };

  res.setHeader('Content-disposition', `attachment; filename=${fileName}`);
  res.setHeader('Content-type', 'application/zip');

  const archive = new OutputZipFile();
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      (archive.outputStream as any).destroy(err);
      reject(err);
    };

    archive.outputStream.on('error', fail);
    res.on('finish', finish);
    res.on('error', fail);
    archive.outputStream.pipe(res);
    archive.addBuffer(Buffer.from(JSON.stringify(archivedData, null, 2)), 'backup.json', {
      compress: true,
      compressionLevel: 9
    });
    for (const image of available) {
      archive.addFile(image.file, `images/${image.filename}`, { compress: true, compressionLevel: 9 });
    }
    for (const image of inline) {
      archive.addBuffer(image.buffer, `images/${image.filename}`, { compress: true, compressionLevel: 9 });
    }
    archive.end();
  });
}

/**
 * Reads only the two entry shapes DVinyl creates. Nothing is extracted by path, which
 * prevents traversal, and every restored image receives a fresh UUID to avoid collisions.
 */
export async function readBackupArchive(file: string): Promise<ImportedBackupArchive> {
  const importedImages: string[] = [];
  let directory: InputZipFile | undefined;
  try {
    directory = await openPromise(file, {
      autoClose: false,
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true
    });
    if (directory.entryCount > MAX_BACKUP_ENTRIES) throw new Error('backup_too_many_entries');

    const seen = new Set<string>();
    let declaredBytes = 0;
    let jsonEntry: Entry | undefined;
    const imageEntries = new Map<string, Entry>();

    for await (const entry of directory.eachEntry()) {
      const entryPath = entry.fileName;
      if (entryPath.endsWith('/') && entryPath === 'images/') continue;
      if (entryPath.endsWith('/') || seen.has(entryPath) || entryPath.includes('\\')) {
        throw new Error('backup_invalid_entry');
      }
      seen.add(entryPath);
      if (entry.isEncrypted()) throw new Error('backup_encrypted_entry');
      if (!entry.canDecodeFileData()) throw new Error('backup_unsupported_entry');

      declaredBytes += entry.uncompressedSize;
      if (declaredBytes > MAX_BACKUP_UNCOMPRESSED_BYTES) throw new Error('backup_too_large');

      if (entryPath === 'backup.json') {
        if (entry.uncompressedSize > MAX_BACKUP_JSON_BYTES) throw new Error('backup_json_too_large');
        jsonEntry = entry;
        continue;
      }

      const match = ARCHIVE_IMAGE.exec(entryPath);
      const filename = match?.[1];
      if (!filename || entry.uncompressedSize > MAX_ARCHIVED_IMAGE_BYTES) {
        throw new Error('backup_invalid_entry');
      }
      imageEntries.set(`/uploads/items/${filename}`, entry);
    }

    if (!jsonEntry) throw new Error('backup_json_missing');
    const json = await readEntryBuffer(directory, jsonEntry, MAX_BACKUP_JSON_BYTES);
    const data = JSON.parse(json.toString('utf8'));
    const referenced = backupImages(data);
    const replacements = new Map<string, string>();

    for (const image of referenced) {
      const entry = imageEntries.get(image);
      if (!entry) continue;
      const buffer = await readEntryBuffer(directory, entry, MAX_ARCHIVED_IMAGE_BYTES);
      if (!isJpegBuffer(buffer)) throw new Error('backup_invalid_image');
      const replacement = await storeItemImage(buffer);
      importedImages.push(replacement);
      replacements.set(image, replacement);
    }

    rewriteBackupImages(data, replacements);
    return { data, importedImages };
  } catch (err) {
    try {
      await deleteUnusedManagedItemImages(importedImages);
    } catch (cleanupError) {
      console.warn('[BACKUP] Failed to clean an invalid archive import:', cleanupError);
    }
    throw err;
  } finally {
    directory?.close();
  }
}
