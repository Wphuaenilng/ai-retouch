import { err } from '../lib/errors';
import { userImageDir } from '../lib/storage';
import { rm } from 'node:fs/promises';
import { all, db, run, tx } from '../db/index';
import { checkCredentials, findUser } from '../store/users';

/**
 * 账号注销：自部署小工具里"被遗忘"应当是真的被遗忘 —— 图片文件、行、
 * 配额账目一起走，不留匿名残留。
 *
 * 一个取舍要写下来：`usage_daily` 是全局日成本熔断的输入，删掉这个人的行会
 * 让**当天**的总成本数字往下掉（预算可能被重新打开）。选择服从"彻底删除"而不是
 * "账面可追溯"，因为熔断是运行时安全阀、不是会计账本；真要做成本审计，
 * 该在 cost-report 里按日落盘，而不是留着已注销用户的行。
 *
 * 顺序是先 DB 事务（全有或全无）再删目录：反过来会出现"文件没了、行还在"的破图，
 * 而那正是 §5.6 里最不该留给用户看到的东西。
 */
export async function deleteAccount(userId: string, username: string, password: string): Promise<{ files: number }> {
  const user = findUser(userId);
  if (!user) throw err('UNAUTHORIZED', '账号已不存在');
  // 注销是不可撤销的：光有会话不够，必须再报一次密码。
  // checkCredentials 里是 scrypt（N=16384），一次验证就够，别为了比较 id 跑两遍
  const who = checkCredentials(username, password);
  if (!who || who.id !== userId) throw err('BAD_CREDENTIALS', '用户名或密码不对，注销没有执行');
  const files = all<{ n: number | bigint }>('SELECT COUNT(*) n FROM images WHERE user_id = ?', userId)[0];

  tx(() => {
    // 别人拿这个账号建过的邀请码要留着（还能用），只把创建人抹成"未知"
    run('UPDATE invites SET created_by = NULL WHERE created_by = ?', userId);
    run('DELETE FROM images WHERE user_id = ?', userId);
    run('DELETE FROM documents WHERE user_id = ?', userId);
    run('DELETE FROM tasks WHERE user_id = ?', userId);
    run('DELETE FROM plans WHERE user_id = ?', userId);
    run('DELETE FROM usage_daily WHERE user_id = ?', userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });

  // 目录是按 userId 分的（putImage 用 userId 建子目录），不是 username
  await rm(userImageDir(userId), { recursive: true, force: true });
  return { files: Number(files?.n ?? 0) };
}
