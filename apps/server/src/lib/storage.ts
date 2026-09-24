import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from '../config';
import { EXT_FOR_MIME } from './imagedims';

const IMAGE_DIR = join(config.DATA_DIR, 'images');
const SAFE = /^[a-z0-9_]+$/i;

/** userId / imageId 都由服务端生成，这里再兜一层防路径穿越 */
export function imagePathFor(userId: string, imageId: string, mime: string): string {
  if (!SAFE.test(userId) || !SAFE.test(imageId)) throw new Error('unsafe image path segment');
  return join(IMAGE_DIR, userId, `${imageId}${EXT_FOR_MIME[mime] ?? '.bin'}`);
}

export async function putImage(userId: string, imageId: string, mime: string, buf: Buffer): Promise<string> {
  const p = imagePathFor(userId, imageId, mime);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, buf);
  return p;
}

export async function readImage(path: string): Promise<Buffer> {
  return readFile(path);
}

export async function imageExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function mimeOfPath(path: string): string {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}
