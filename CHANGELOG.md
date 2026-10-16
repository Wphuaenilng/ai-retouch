# 更新记录

格式按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号按[语义化版本](https://semver.org/lang/zh-CN/)。

**当前还没有发过版本、也没打过 tag**（三包仍是 `0.1.0`，且 `private: true` 表示不发布到 npm）。
下面的"未发布"就是仓库现在的样子；打第一个 tag 时才需要往下挪。

## [未发布]

邀请制小范围自部署版本已可用（Mock 上游全链路通；万相与 gpt-image 中转站**已拿真 key 实测**，Seedream **尚未**）。

### 新增

- **工具箱按上游真实能力置灰**：`/api/config` 下发 `capabilities`（当前配置真做得到的能力，与 Agent 规划同一份口径），前端据此把做不到的 AI 工具灰掉并写明原因（"当前配置的上游做不到「按选区局部重绘」"），价格位换成"做不到"。灰而不停、不藏 —— 藏起来会让人以为功能被删了。默认选中的工具若正好是被挡的那个（就是 `cutout`）会自动换成做得到的那一个。
- **gpt-image 适配器** `openai_images`：接 OpenAI 官方或任意兼容中转站（`OPENAI_IMAGES_BASE_URL/API_KEY/MODEL`）。**只声明 text2image** —— 它的图生图要 multipart、三档标准尺寸输入与透明通道遮罩，服务端没有像素处理能力，接不动；非标准比例（16:9 等）自动吸附到三档之一，任务与历史里报的是落盘的真实尺寸。2026-09-28 拿中转站真 key 实测：文生图通、一发约 27s、回 `data[].url`（图要再从 URL 拉回来）；站方**不回 `usage`**（成本按 `OPENAI_IMAGES_PRICE_YUAN` 估）、**静默忽略 `quality`**；它的 `/images/edits` 要 `images[].image_url`，塞 dataURL 直接 502 —— 所以编辑接不了，除非先把公网图片外链那件事做回来。
- **账号注销**：`DELETE /api/me`（要再输一次用户名与密码）——图片文件、项目、任务、配额账目一起清，别人拿他邀请码注册的账号不受影响。
- **历史记录页** `/history`：按状态筛、给耗时与成本、打开项目与下载结果，翻页读更早的。
- **文生图候选网格**：选 2/4 张时点一张当当前图（几张本来就都入库了）。
- **首次上传前的一次性隐私告知**：确认时间记在账号上（换浏览器会再问），侧栏常驻全文；文案单一来源。
- **邀请码期限**：默认 30 天，管理页可选 7/30/90/不限，并列出还没用掉的码与到期日；过期与"被人用掉"分开报。
- **每日成本报表** `pnpm --filter @retouch/server cost-report`：退出码 `0/2/3` 分别对应正常 / 成本达预算 80% / 失败率过半，可直接接 cron。
- **请求编号**：每个请求一个短编号，回 `x-request-id` 头，500 的提示里直接带编号；服务层日志改结构化。
- **恢复脚本** `deploy/restore.sh` + `restore.mjs`：先报快照的行数与 schema 版本再动手，目标库已存在时要 `--force`，`--images` 连图片目录一起还原。
- **手机档布局**（≤639px）与 `env(safe-area-inset-*)`；`⌘0/⌘1` 与 `1:1` 按钮；图层上下移与不透明度；矩形框选。
- `docs/07-运维手册.md`（含环境变量全表与"现象→真因"对照）。

### 改变

- **万相适配器按 2.6 协议重写，并首次拿真 key 实测**（2026-09-28）：改走**同步** `/services/aigc/multimodal-generation/generation`（`input.messages[].content[]` 带 `{text}`/`{image}`，图支持 dataURL；结果取 `output.choices[].message.content[].image`），不再发 `X-DashScope-Async` 也不轮询 —— 老写法（`text2image/image-synthesis` + `input.prompt`）对 `wan2.6-*` 直接 400 `url error`。**能力按实测收口**：`wanx` 只声明 `text2image` 与 `edit`，遮罩会被上游拒、超分与抠图是别的模型，所以 `inpaint/outpaint/upscale/segment` 不再挂它名下（没配别的 key 时这些工具会明确报"没有可用的模型"，而不是静默出占位图）。顺带删掉因此没人用的 `poll` / `getJson` / `ProviderPoll`。
- **文生图任务与历史里报的是落盘尺寸，不是请求尺寸**：万相会把 `1100*900` 吸附成 `1088*896`、gpt-image 只认三档，请求里那一对从来不可信。
- **`ARK_IMAGE_MODEL` 的默认值修掉了**：原来写的 `doubao-seedream-4-5-250828` 在火山方舟上**不存在**（09-28 拿真 key 列过模型），改成在架的 `doubao-seedream-4-0-250828`，在架清单记进 `config.ts` 与 07。同一轮实测：这把 key 能鉴权，但账号未开通任何 Seedream 图像模型（五个在架版本全 `404 ModelNotOpen`），所以 4.1 还差控制台那一下点击。
- **内容审核故障分档**：审核服务不可用时，**成品图拒绝出图**（要发给别人看的那张宁停不错发），**上传放行**；错误码分开成 `MODERATION_UNAVAILABLE`。开 `qwen-vl` 却没配 key 时直接拒绝启动。
- **图片与项目删除是彻底的**：文件、行、以及画布/任务里的引用一起清；任务行作为账本保留。删项目不带走共享的原图。
- 前端按路由懒加载：入口从 767KB 单块拆成 399 + 372 + 3.3KB，未进编辑台不下发 Konva。
- 生产不再随产物发 sourcemap；只有带内容哈希的 `assets/*` 才 `immutable`，html 一律 `no-cache`。
- 迁移走 `PRAGMA user_version`（现在到 v5），每条迁移与版本号同事务；库版本比代码新时拒绝启动。
- 默认 `JWT_SECRET` 在生产**拒绝启动**（原来只是文档提醒）。
- Node 下限写进 `engines`：`>=22.13.0`（`node:sqlite` 在那之前藏在 flag 后面）。

### 去掉

- 三个**看着能用其实不生效**的表单选项：文生图"清晰度 2K/4K · 加价"、扩图"扩展方向"、裁剪的 `cropRect` + `target`/`layerId`。
- 死代码与死配置：`signedImageUrl` 与读图路由上"带 sig 免 Cookie"那条旁路（签发侧零调用，纯攻击面）、`IMAGE_FALLBACK_TO_MOCK`。
- `text` 图层（没有工具也没有渲染器，留着只是让 zod 静默剥数据）。
- 计划里明确砍掉的范围：套索选区、多图融合的前端选择、OCR 文字层、服务端 sharp 导出、PostgreSQL 迁移、`sharpness` 滑块。

### 已知边界

工程侧见 [docs/03-实现说明.md](./docs/03-实现说明.md) §3-§4（含威胁模型与"没挡的"清单），
欠账与修复顺序见 [docs/05-修复与收尾计划.md](./docs/05-修复与收尾计划.md)。
一句话版：**三个上游适配器里万相与 gpt-image 已拿真 key 实测（09-28），Seedream 仍未验**；已验证的上游只覆盖 `text2image` 与 `edit`，其余六个 P0 工具目前没有做得到它的真实上游、而工具箱照旧摆着那些按钮（登记为 05 的 D31，出口是 4.9）；Docker 镜像未在本机构建验证；大图性能与 360/390/430 截图归档待做。
