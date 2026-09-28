# retouch-studio · 修图台

自部署的 AI 修图工作台：工具箱式单项修图 + 自然语言 Agent 对话修图 + Konva 图层画布编辑器。
技术路线是**云端图像编辑模型 API 聚合**（火山方舟 Seedream / 阿里云百炼万相），无 GPU 依赖，邀请制小范围分享，桌面网页优先。

## 快速开始（本机开发）

前置：Node **≥ 22.13**（`node:sqlite` 在这个版本前还藏在 `--experimental-sqlite` 后面，`--env-file-if-exists` 也要 22.9+）、pnpm 10（`corepack enable` 即可按 `packageManager` 装对）。

```bash
cp .env.example .env          # 默认即可跑：Mock 上游，不需要任何 API Key
pnpm install
pnpm dev                      # 起服务端 8787 + 前端 5173（Vite 代理 /api）
```

打开 http://127.0.0.1:5173 ，用 `.env` 里的 `BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD` 登录；
在管理页（/admin）生成邀请码，就能注册普通账号。

只跑后端：`pnpm dev:server`；接口自检：`curl http://127.0.0.1:8787/api/health`

## 验证手段

| 命令                                  | 覆盖                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm verify`                         | 上面全部的串联闸门（typecheck + format:check + lint + test + build），提交前跑这个就是绿的                                                                                                 |
| `pnpm typecheck`                      | 三个包全量类型检查                                                                                                                                                                         |
| `pnpm test`                           | 97 例：迁移与版本表、配额账本、任务超时取消、计划抢占锁、审核故障分档、邀请码期限、账号注销、删除级联、计划校验器、规则式规划器、PNG 编解码、画布矩阵、编辑器 store（75 服务端 + 22 前端） |
| `pnpm --filter @retouch/server smoke` | 端到端 30 项：注册/邀请码一次性/越权/上传/任务/SSE/结果下载/遮罩直传/隐私告知/Agent 多步/配额/错误码                                                                                       |
| `pnpm build`                          | 前端产物构建（编辑台按路由懒加载，首屏 399KB / gzip 126KB）                                                                                                                                |

冒烟脚本要求服务已在跑，且 `.env` 配了 `BOOTSTRAP_ADMIN_*`（可用 `SMOKE_ADMIN_USER/SMOKE_ADMIN_PASS` 覆盖）。

## 接真实模型

`.env` 里填 key 并把 `PROVIDER_PRIORITY` 改成 `seedream,mock`（或 `wanx,mock`）：

```
ARK_API_KEY=...            # 火山方舟 → Seedream 图像生成/编辑
DASHSCOPE_API_KEY=...      # 阿里云百炼 → 通义万相
LLM_PLAN_PROVIDER=openai   # Agent 规划改用真模型（默认 mock = 规则式，离线可用）
LLM_API_KEY=... LLM_MODEL=qwen-plus
MODERATION=qwen-vl         # 内容审核（分享给别人之前建议开）
```

> ⚠️ 两个上游适配器（`apps/server/src/providers/seedream.ts`、`wanx.ts`）**尚未用真实 key 跑过**，
> 字段名与端点需按各家当前文档核对；业务层只依赖统一的 `ProviderRequest/ProviderResult`，
> 对不上时只改适配器文件。

## 部署

```bash
cp .env.example .env   # 必填 JWT_SECRET / PUBLIC_BASE_URL / SITE_ADDRESS，以及各 key
docker compose up -d --build
```

Caddy 负责 HTTPS 与 SSE 不缓冲（`flush_interval -1`）。`SITE_ADDRESS` 没设的话 compose 直接报错退出，不再静默签一个 `localhost` 证书。

备份：`./deploy/backup.sh`（本机）或 `docker compose exec app /app/deploy/backup.sh`（容器内）。SQLite `VACUUM INTO` 快照 + 图片打包，写到 `$BACKUP_DIR`（compose 里是卷内的 `/data/backups`），保留 14 天，目录里留一个 `latest.db` 指向最新快照。
恢复演练：

```bash
docker compose stop app
docker compose exec app /app/deploy/restore.sh /data/backups/latest.db --force
docker compose up -d app
```

`restore.sh` 会先报出快照的行数与 schema 版本再动手，目标库已存在时必须 `--force`；加 `--images <images-*.tgz>` 连图片目录一起还原。
国内服务器 + 域名提供 Web 服务需 ICP 备案，未备案可先用 IP 或港服。

## 文档

仓库内的设计文档随 git 分发、但不进镜像（见 `.dockerignore`）：产品定位与决策在 `docs/01`，执行方案在 `docs/02`，实现偏差与诚实清单在 `docs/03`，使用手册在 `docs/04`，当前唯一的销账清单在 `docs/05-修复与收尾计划.md`，**长期跑起来怎么运维在 `docs/07-运维手册.md`（含环境变量全表与"现象→真因"表）**。界面设计稿在 `design/`，是本地资料。

## 结构

```
apps/web      React 19 + Vite + react-konva + zustand（工具箱 / 编辑台 / 管理）
apps/server   Fastify + node:sqlite + 自研持久队列 + SSE + Provider 适配层
packages/shared  工具注册表（zod schema + 表单字段 + Agent 提示）· 类型 · 错误码
deploy        Dockerfile / Caddyfile / 备份与恢复脚本
```

工具注册表是唯一事实来源：加一个工具 = 在 `packages/shared/src/tools.ts` 写一条 `ToolDef`，
再在 `apps/server/src/tools/runners.ts`（AI 工具）或 `apps/web/src/lib/clientTools.ts`（本地工具）实现执行体，
工具箱表单、Agent 可规划范围、成本提示都会自动跟上。
