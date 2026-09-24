/** 浏览器端做像素处理：服务端不装 sharp，压缩与缩略图在这里完成 */

export interface PreparedUpload {
  original: Blob;
  edit: Blob;
  thumb: Blob;
  width: number;
  height: number;
}

const MAX_EDGE_DEFAULT = 2048;

async function toBlob(canvas: HTMLCanvasElement, type: string, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画布导出失败'))), type, quality);
  });
}

function drawScaled(source: CanvasImageSource, sw: number, sh: number, maxEdge: number): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return c;
}

/**
 * 原图按上传不重编码（保留 EXIF 方向交给 createImageBitmap 处理），
 * 编辑副本与缩略图重绘到 canvas 后导出 WebP。
 */
export async function prepareUpload(file: File, maxEdge = MAX_EDGE_DEFAULT): Promise<PreparedUpload> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(async () => {
    // Safari 对 imageOrientation 选项支持不全时退回无选项
    return createImageBitmap(file);
  });
  const width = bitmap.width;
  const height = bitmap.height;
  const edit = await toBlob(drawScaled(bitmap, width, height, maxEdge), 'image/webp', 0.94);
  const thumb = await toBlob(drawScaled(bitmap, width, height, 256), 'image/webp', 0.8);
  bitmap.close?.();
  return { original: file, edit, thumb, width, height };
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(head)?.[1] ?? 'image/png';
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function canvasToBlob(canvas: HTMLCanvasElement, mime = 'image/png'): Promise<Blob> {
  return toBlob(canvas, mime);
}

/** 遮罩画布：白=要处理，透明=保留。尺寸与原图一致，避免上游再缩放 */
export function createMaskCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

export function drawMaskStroke(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number } | null,
  to: { x: number; y: number },
  size: number,
): void {
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size;
  if (from) {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(to.x, to.y, size / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function downloadBlobUrl(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
