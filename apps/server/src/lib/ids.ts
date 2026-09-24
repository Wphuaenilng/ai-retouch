import { randomBytes, randomUUID } from 'node:crypto';

/** 任务/文档/图片 id：前缀 + 20 位十六进制，日志里一眼能分辨类型 */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}
export const newTaskId = () => newId('tk');
export const newImageId = () => newId('im');
export const newDocId = () => newId('dc');
export const newPlanId = () => newId('pl');
export const newUserId = () => newId('us');
export const newRequestId = () => newId('rq');

export function newInviteCode(): string {
  return randomBytes(8).toString('hex').toUpperCase();
}

export function usernameTaken(username: string): string {
  return username.trim().toLowerCase();
}
