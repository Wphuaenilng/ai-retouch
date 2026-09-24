import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sniffImage } from '../src/lib/imagedims';
import { Rgba } from '../src/lib/png';

describe('零依赖 PNG 编解码闭环', () => {
  it('编码出的字节流能被自己的嗅探器识别为合法 PNG 且尺寸一致', () => {
    const c = new Rgba(37, 23, [10, 20, 30, 255]);
    c.fillRect(2, 2, 10, 10, [200, 80, 60, 255]);
    const buf = c.toPng();
    const info = sniffImage(buf);
    assert.ok(info);
    assert.equal(info!.mime, 'image/png');
    assert.equal(info!.width, 37);
    assert.equal(info!.height, 23);
  });

  it('透明像素保持 alpha 通道（抠图结果要能直接当图层用）', () => {
    const c = new Rgba(8, 8);
    c.fillRect(0, 0, 4, 8, [255, 255, 255, 255]);
    const info = sniffImage(c.toPng());
    assert.equal(info!.width, 8);
  });
});
