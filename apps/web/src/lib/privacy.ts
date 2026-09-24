import { api } from './api';

/**
 * 隐私告知的文案与确认入口。放在一处是因为它有两处出口：首次上传前的弹窗、
 * 账号面板里的常驻说明 —— 两处说法不一致比没有说法更糟。
 *
 * 只写已经成立的事实。"你可以随时删除"这类话现在还是假的（删除路由见 05 的 5.8），
 * 就照实说"还在做"。
 */
export const PRIVACY_LINES: string[] = [
  '图片会原样传给第三方模型服务做编辑（火山方舟 Seedream / 阿里云百炼万相，取决于服务端配置），它们如何留存由服务商的条款决定。',
  '你输入的描述文字会传给规划模型，用来把"再亮一点、背景换成海边"拆成具体步骤。',
  '遮罩（你涂抹/框选的区域）也会上传，因为它画在你的图上，消除类工具要靠它定位。',
  '本站会在服务器与每日备份里保留原图、编辑副本、遮罩和结果图，不做端到端加密。',
  '按自己的判断别把不该给别人看的图传上来。',
];

export const PRIVACY_NOTE = '确认之后仍然可以随时取消：不上传就不会有任何东西离开这台机器。';

/** 记在账号上而不是 localStorage：换浏览器 / 清缓存都应该重新问过 */
export async function acceptConsent(): Promise<string> {
  const r = await api.post<{ consentAt: string }>('/api/consent');
  return r.consentAt;
}
