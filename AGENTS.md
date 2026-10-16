# retouch-studio

## 品牌规则（钧天 · Juntian Works）

本项目属于钧天，产品名**保持「暗房 / retouch-studio」，不加"钧天"前缀**。品牌统一由署名行、母题、色族承担，不靠产品名。

### 两层颜色，别混用

- **品牌层**（落地页、关于页、水印、导出署名、分享封面）：只用钧天 9 值，走 `@juntian/brand/tokens.css` 的 `--jt-*` 变量。
- **产品 UI 层**：继续用 `apps/web/src/styles/tokens.css` 里的语义变量（`--bg --panel --line --ink --amber --red --green`）。暗房暖色段是已登记的品牌派生段，不要为了对齐品牌而把它改成冷蓝。

> ⚠️ 命名反义陷阱：产品的 `--ink` 是**亮文字** `#e9e9e5`，品牌的 `ink` 是**最深底色** `#08141F`。跨层复制变量名前先确认含义。

### 品牌 9 值白名单

```
#08141F ink  #0F2C45 deep  #1D5C9C brand  #2E7FCB bright  #5C7F9A line
#35C7F0 glow  #EAF2F8 paper  #0A1B28 text  #E5A44B signal
派生图元色：#0A1826 panel底  #0E2434 / #143349 图纸栅格线（只作图元，不作 UI 主色）
```

硬规则：亮底固定冷白 `#EAF2F8`，**品牌层禁用米色/暖白**；`glow` 同画面只出现一处；暗底正文 ≥ `#C9DCEC`、≥14px、对比度 ≥4.5:1。

### 需要新色值时

不要就地写 hex。三选一，按顺序考虑：
1. 用现有 token 或它的透明度变体；
2. 确实是产品需要的语义色 → 加进 `apps/web/src/styles/tokens.css`，并登记到 `brand-juntian/tokens.json` 的 `productPalettes`；
3. 都不合适 → 先改 `brand-juntian/brand.md` 再改代码。**文档没写而代码里出现的颜色，就是漂移。**

### 检查与棘轮

```bash
node ../brand-juntian/bin/check-brand.mjs apps/web/src --baseline brand.baseline.json
# 或 pnpm brand:check
```

越界数超过 `brand.baseline.json` 里的基线（当前 31）即 exit 1。合理新增后跑 `--update` 收紧。临时豁免在行尾加 `/* brand-check-allow */`。

### 字体

中文标题 Noto Sans SC 800 / 正文 400，数字与代码 JetBrains Mono，拉丁标题 Space Grotesk。品牌层字体随 `@juntian/brand` 走 `fonts.css` 的 `@font-face`；产品 UI 沿用现有 `--sans/--mono` 栈，不改。

### 母题与署名

图形母题只有一个：`mark.svg` 的中心定位十字（陶轮环 + 四方尺寸线 + 八方短刻）。不新造图标风格、不加装饰性几何。品牌层页脚署名：

```
钧天 · Juntian Works ｜ 造物与图纸 ｜ juntian.dev
```
