/**
 * 纯 JS 读取图片宽高与 MIME —— 服务端不做像素处理（无原生依赖），
 * 编辑副本与缩略图由前端 canvas 生成后一起上传，这里只负责校验真实尺寸。
 */

export interface ImageInfo {
  mime: string;
  width: number;
  height: number;
}

export function sniffImage(buf: Buffer): ImageInfo | null {
  if (buf.length < 12) return null;
  if (isPng(buf)) return { mime: 'image/png', ...pngSize(buf)! };
  if (isWebp(buf)) {
    const s = webpSize(buf);
    return s ? { mime: 'image/webp', ...s } : null;
  }
  if (isGif(buf)) return { mime: 'image/gif', ...gifSize(buf) };
  if (isJpeg(buf)) {
    const s = jpegSize(buf);
    return s ? { mime: 'image/jpeg', ...s } : null;
  }
  return null;
}

const isPng = (b: Buffer) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isGif = (b: Buffer) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;
const isWebp = (b: Buffer) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
const isJpeg = (b: Buffer) => b[0] === 0xff && b[1] === 0xd8;

function pngSize(b: Buffer) {
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function gifSize(b: Buffer) {
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function webpSize(b: Buffer) {
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && b.length >= 30) {
    return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  }
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = b.readUInt32LE(17);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (chunk === 'VP8 ' && b.length >= 30) {
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

/** JPEG 需要遍历 marker 找 SOF0..SOF15 */
function jpegSize(b: Buffer) {
  let off = 2;
  while (off + 9 < b.length) {
    if (b[off] !== 0xff) {
      off += 1;
      continue;
    }
    const marker = b[off + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(off + 5), width: b.readUInt16BE(off + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2;
      continue;
    }
    off += 2 + b.readUInt16BE(off + 2);
  }
  return null;
}

export const EXT_FOR_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

export const ACCEPTED_MIMES = Object.keys(EXT_FOR_MIME);
