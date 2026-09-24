import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { untilText } from '../src/lib/time';

const NOW = new Date('2026-09-24T10:00:00.000Z').getTime();

describe('untilText', () => {
  it('不到一小时只说分钟', () => {
    assert.equal(untilText('2026-09-24T10:20:00.000Z', NOW), '20 分后');
  });

  it('一小时以上带上小时', () => {
    assert.equal(untilText('2026-09-24T16:30:00.000Z', NOW), '6 小时 30 分后');
  });

  it('超过一天换算成天', () => {
    assert.equal(untilText('2026-09-26T06:00:00.000Z', NOW), '1 天 20 小时后');
  });

  it('时刻已过或读不出来说"刚刚"，不给出负数', () => {
    assert.equal(untilText('2026-09-24T09:00:00.000Z', NOW), '刚刚');
    assert.equal(untilText('not-a-date', NOW), '刚刚');
  });
});
