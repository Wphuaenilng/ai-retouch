import { deflateSync } from 'node:zlib';

/**
 * 零依赖 PNG 编码器。服务端不装 sharp（本机没有编译链），
 * 但 Mock Provider 需要产出真实可存储、可再喂给上游模型的位图，
 * 所以手写一个最小编码器：IHDR + IDAT(deflate, filter 0) + IEND。
 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 简易画布：够画出可辨识的占位图，不做抗锯齿 */
export class Rgba {
  data: Uint8Array;
  constructor(readonly w: number, readonly h: number, fill: [number, number, number, number] = [0, 0, 0, 0]) {
    this.data = new Uint8Array(w * h * 4);
    if (fill.some((v) => v !== 0)) this.fillRect(0, 0, w, h, fill);
  }
  set(x: number, y: number, c: [number, number, number, number]) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const a = c[3] / 255;
    const oa = this.data[i + 3] / 255;
    const na = a + oa * (1 - a);
    if (na === 0) {
      this.data[i] = this.data[i + 1] = this.data[i + 2] = this.data[i + 3] = 0;
      return;
    }
    for (let k = 0; k < 3; k += 1) {
      this.data[i + k] = Math.round((c[k] * a + this.data[i + k] * oa * (1 - a)) / na);
    }
    this.data[i + 3] = Math.round(na * 255);
  }
  fillRect(x: number, y: number, w: number, h: number, c: [number, number, number, number]) {
    for (let j = Math.max(0, y); j < Math.min(this.h, y + h); j += 1)
      for (let i = Math.max(0, x); i < Math.min(this.w, x + w); i += 1) this.set(i, j, c);
  }
  /** 5x7 点阵数字，够画任务号与百分比 */
  digit(x: number, y: number, ch: string, c: [number, number, number, number], scale = 2) {
    const map: Record<string, string[]> = {
      '0': ['0110', '1001', '1011', '1001', '1110'],
      '1': ['0100', '1100', '0100', '0100', '1110'],
      '2': ['1110', '0001', '0110', '1000', '1111'],
      '3': ['1110', '0001', '0110', '0001', '1110'],
      '4': ['1010', '1010', '1111', '0010', '0010'],
      '5': ['1111', '1000', '1110', '0001', '1110'],
      '6': ['0110', '1000', '1111', '1001', '0110'],
      '7': ['1111', '0001', '0010', '0100', '0100'],
      '8': ['0110', '1001', '0110', '1001', '0110'],
      '9': ['0110', '1001', '0111', '0001', '1110'],
      '%': ['1010', '0010', '0100', '0101', '1001'],
      '.': ['0000', '0000', '0000', '0000', '0100'],
      '#': ['1010', '1111', '1010', '1111', '1010'],
    };
    const g = map[ch];
    if (!g) return;
    for (let r = 0; r < 5; r += 1)
      for (let col = 0; col < 4; col += 1) if (g[r][col] === '1') this.fillRect(x + col * scale, y + r * scale, scale, scale, c);
  }
  text(x: number, y: number, s: string, c: [number, number, number, number], scale = 2) {
    let cx = x;
    for (const ch of s) {
      this.digit(cx, y, ch, c, scale);
      cx += 5 * scale;
    }
  }
  toPng(): Buffer {
    return encodePng(this.w, this.h, this.data);
  }
}
