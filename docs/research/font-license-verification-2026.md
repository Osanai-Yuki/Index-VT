# 内嵌字体许可证核查与换字体评估

**主题**：Index-VT 三份内嵌 woff2（拉丁界面字 / 中文 / 等宽数字）的许可证核查，
以及「换成授权更宽松的字体」这一诉求的可行性结论。

**结论先行**：**这三份字体已经是商用最宽松一档的许可（SIL OFL 1.1），换字体拿不到任何授权减免。**
真实存在的缺口不是字体选型，而是**许可证文本没有随产物分发**——已修，并由门禁锁住。

本文件的每条许可证事实都来自**本机实读**的上游 `OFL.txt` 原文（用
`Invoke-WebRequest` 从各字体官方仓库取回，条目里给出 URL），不是搜来的二手说法。

---

## 1. 核查方法

| 手段 | 用途 |
|---|---|
| `Invoke-WebRequest` 取上游 `OFL.txt` | 读**版权行**与**保留字体名（Reserved Font Name）**——OFL §3 只认这两样，族名/README 都不算数 |
| `tools/fonts/report-fonts.py` | 读产物自身的 `name` 表 0/1/16 号记录，核对版权行与族名 |
| `tools/fonts/report-features.py` | 核对 OpenType 特性（`tnum` 等）与数字宽度，确认功能需求不因换字体而退化 |

**为什么必须读 OFL 原文**：OFL §3 说 Modified Version 不得使用保留字体名，而保留名**只**声明在
版权行里。同一款字体在不同渠道分发的 OFL 可能不同——本仓库内嵌的 Noto Sans SC 用的是
**Adobe 版权版**（保留名 `'Source'`），与「Noto」这个名字给人的直觉完全不符。

---

## 2. 内嵌字体的核查结果

下表是**换字后（v2.2）的当前状态**；旧字体（Archivo / JetBrains Mono）的核查结论同样在下，
因为换字之前必须先证明旧字体没有授权问题，才能把「换字」定性为纯视觉变更。

| 内嵌文件 | 上游 | 版权行（实读） | 保留字体名 | 子集族名 | §3 判定 |
|---|---|---|---|---|---|
| `public-sans-latin-wght400-600.woff2` | [Public Sans](https://github.com/google/fonts/blob/main/ofl/publicsans/OFL.txt) | `Copyright 2015 The Public Sans Project Authors` | **无** | `Public Sans` | 合法 |
| `noto-sans-sc-cjk-wght400-600.woff2` | [Noto Sans SC](https://github.com/google/fonts/blob/main/ofl/notosanssc/OFL.txt) | `Copyright 2014-2021 Adobe, with Reserved Font Name 'Source'` | **`'Source'`** | `Noto Sans SC` | 合法（族名不含 `Source`） |
| `geist-mono-latin-wght400-500.woff2` | [Geist Mono](https://github.com/google/fonts/blob/main/ofl/geistmono/OFL.txt) | `Copyright 2024 The Geist Project Authors` | **无** | `Geist Mono` | 合法 |

换字前已退役的两份（现存放于 `.font-work/retired/`，不入库）：

| 已退役文件 | 上游 | 版权行（实读） | 保留字体名 | §3 判定 |
|---|---|---|---|---|
| `archivo-latin-wght400-600.woff2` | [Archivo](https://github.com/google/fonts/blob/main/ofl/archivo/OFL.txt) | `Copyright 2020 The Archivo Project Authors` | **无** | 合法 |
| `jetbrains-mono-latin-wght400-500.woff2` | [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt) | `Copyright 2020 The JetBrains Mono Project Authors` | **无** | 合法 |

**为什么 §3 会生效**：三份产物都经 `pyftsubset` 处理，且构建时**钳制了 `fvar` 的 `wght` 轴并重写了
`instances`**。OFL 对 Modified Version 的定义是「增加、删除或替换原始版本的部分组件……**或转换格式**」——
改轴与转 woff2 两条都踩中，所以产物是 Modified Version，§3 适用，不是「原样再分发」。

**OFL 1.1 的义务只有四条**（三份通用，逐字取自实读原文）：

1. §1 不得**单独**售卖字体本身（随软件一起卖是明确允许的）；
2. §2 每份拷贝须含版权声明与本许可证，载体可以是独立文本文件 / 可读头 / **可被用户轻易看到的**机器可读字段；
3. §3 Modified Version 不得使用保留字体名；
4. §4 不得用作者名义为衍生版本背书。

**授予的权利**（原文逐字）：`use, study, copy, merge, embed, modify, redistribute, and sell`，
以及 `The fonts, including any derivative works, can be bundled, embedded, redistributed and/or sold with any software`。
**商用、内嵌、闭源分发都在这句里，不存在灰色地带。**

---

## 3. 换字体能拿到什么：没有

按上面的义务清单，把 OFL 换成别的许可只会**增加**义务或引入不可控条款：

| 目标许可 | 相对 OFL 1.1 的变化 | 判定 |
|---|---|---|
| **OFL 1.1**（现状） | — | 义务最少的一档 |
| Apache-2.0 | **多**一条 `NOTICE` 义务 + 专利终止条款 | 更重 |
| MIT | 义务更轻，但**几乎没有**够格的neutralsans/CJK 字体是 MIT（知名 MIT 等宽 Hack 只有静态字重，不满足可变轴需求） | 不可得 |
| 厂商 EULA（MiSans / HarmonyOS Sans / OPPO Sans / 阿里巴巴普惠体 / Fontshare ITF-FFL） | 自定义条款：内嵌、**子集化（= 修改）**、可否撤销、署名位置全部需逐条读；且多含「不得修改字体」或「不得用于字体类产品」一类限制 | 显著更重且不可控 |

> **中文厂商字体的实测风险**：华为开发者论坛存在一条悬而未决的提问——
> 「HarmonyOS Sans 字体子集压缩后在商业项目中使用是否合规？」——**厂商自己的社区没有给出确定答复**。
> 把不可撤销的 OFL 授权换成「免费商用」的营销措辞 + 未读的 PDF 协议，方向是反的。

### 缺字回退的既有边界（与许可无关，但同属 CJK 选型）

当前 CJK 子集为 GB2312 档：**生僻字、繁体、韩文不在字库内**，浏览器按字形回退系统
`Microsoft YaHei UI`，同一段文本里可能出现字形混排。这是 1.72MB 对 16.9MB（上游全量）的取舍，
口径见 `DESIGN.md` §3.1。换任何 CJK 字体都不改变这条边界，只改变体积。

---

## 4. 候选字体的实测（同口径子集）

用同一份字符集合同、同一字重区间、同一套 `pyftsubset` 选项构建（`tools/fonts/compare-candidates.py`），
所以下表的体积是可比较的：

### 4.1 拉丁界面字（`charsets/latin-ui.txt`，233 码位，wght 400–600）

| 字体 | 许可 | 上游 OFL 版权行 | 保留字体名 | 子集体积 | 状态 |
|---|---|---|---|---|---|
| **Public Sans** | OFL 1.1 | `The Public Sans Project Authors` | 无 | **26.1 KB** | ✅ **已采用（v2.2）** |
| Golos Text | OFL 1.1 | `The Golos Text Project Authors` | 无 | 38.9 KB | 备选 |
| Schibsted Grotesk | OFL 1.1 | （未取原文） | — | 48.2 KB | 备选 |
| Instrument Sans | OFL 1.1 | `The Instrument Sans Project Authors` | 无 | 75.2 KB | 备选（带 `wdth` 轴） |
| Work Sans | OFL 1.1 | （未取原文） | — | 75.9 KB | 备选 |
| Archivo | OFL 1.1 | `The Archivo Project Authors` | 无 | 18.3 KB | 已退役（v2.2 前在用） |
| IBM Plex Sans | OFL 1.1 | `Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"` | **`Plex`** | （未测） | 未选：有保留字体名，且属 v2.0 前旧字体家族 |
| Inter | OFL 1.1 | （未取原文） | — | （未测） | ❌ **本项目禁止**：`DESIGN.md` §3.1 点名 Inter 属过度使用的默认字体，`verify-theme` #7 会红 |

### 4.2 等宽数字（`charsets/latin-mono.txt`，229 码位，wght 400–500）

| 字体 | 许可 | 保留字体名 | 子集体积 | 数字宽度 | 状态 |
|---|---|---|---|---|---|
| **Geist Mono** | OFL 1.1 | 无 | 33.8 KB | 全部 600 units（天然等宽） | ✅ **已采用（v2.2）** |
| JetBrains Mono | OFL 1.1 | 无 | 30.7 KB | 全部 600 units | 已退役（v2.2 前在用） |

**关键事实**：两份等宽字体的数字**天然等宽**（10 个数字的 advance 全等于 600 units），
所以 `DESIGN.md` §3.4 依赖的 `font-variant-numeric: tabular-nums` **不依赖 `tnum` 特性**——
产物里没有 `tnum` 也不影响时间码列对齐。这消除了「换等宽字体有功能风险」的顾虑。

---

## 5. 已实施的修复（本次真正解决的问题）

### 5.1 真缺陷：许可证文本没有随 exe 分发（OFL §2 当时不满足）

- **修复前**：`app/frontenddist/` 内只有 3 份 woff2 + js + css，**没有任何许可证文本**。
  原因是两份 `OFL-*.txt` 放在 `frontend/src/assets/fonts/`，而那里**没有被任何模块 `import`**，
  Vite 只打包被引用到的资源，于是静默丢弃；`vite.config.ts` 也没有声明 `publicDir`，
  `frontend/public/` 根本不存在。
- **影响**：字体随 exe 分发、许可证没进 exe ⇒ OFL §2 未满足。**这是真实合规缺口，不是理论风险。**
  （单文件 exe 里用户打不开 woff2 的 `name` 表，所以 §2 允许的「机器可读字段」这一路走不通，
  必须落成独立文本文件。）
- **修复**：三份许可证文本落在 `frontend/public/licenses/`，Vite 原样拷贝到 `dist/licenses/`（已验证产物内存在）。

### 5.2 真缺陷：三份子集的 `name` 表族名是错的

| 文件 | 修复前族名 | 修复后 | 实际字重轴 |
|---|---|---|---|
| `noto-sans-sc-cjk-…woff2` | `Noto Sans SC **Thin**` | `Noto Sans SC` | wght 400–600 |
| `archivo-latin-…woff2` | `Archivo **SemiBold**` | `Archivo` | wght 400–600 |
| `jetbrains-mono-latin-…woff2` | `JetBrains Mono` | `JetBrains Mono`（补 16/17 号记录） | wght 400–500 |

成因：子集化会重写 `fvar`，把**默认实例名**留在了族名字段上。CSS 不读这些字段（族名由 `@font-face`
决定），但字体管理器 / 安装器 / 检查工具会读，会报出一个该文件渲染不出的字重。
修法见 `tools/fonts/fix-name-table.py`：**只改 `name` 表，不动轮廓**，
覆盖与体积零变化（7764 码位 / 7764 字形、1760.6 KB 前后一致）。

### 5.3 回归锁

| 门禁 | 断言 |
|---|---|
| `verify-theme` #11 | `dist/licenses/` 三份齐全，且各自含 OFL 正文与对应版权行 |
| `verify-theme` #12 | **换字体闸门**：产物 `@font-face` 里的每个族名都必须在许可证审计表登记过，未登记即红 |

#12 的设计意图：将来任何人换字体，都必须先在 `verify-theme.mjs` 里写下该字体的许可证结论
（保留字体名是什么、为何可以沿用原名）。门禁不接受「悄悄换一个字体」。
另注：#12 **不能**用「grep woff2 二进制里有没有保留名」来实现——woff2 的 `name` 表在 brotli
压缩流里，明文搜索恒为 0 命中，那样的断言永远通过却什么都没检查。

---

## 6. 结论与已执行的动作

1. **三份字体的授权无需更换。** 它们已是 OFL 1.1、可商用、可内嵌、可修改，且
   Public Sans 与 Geist Mono 连保留字体名都没有——是 OFL 里义务最少的那种形态。
2. **不采用厂商 CJK 字体**（MiSans / HarmonyOS Sans / OPPO Sans / 阿里巴巴普惠体）。
   理由见 §3：把不可撤销的 OFL 授权换成未读的自定义协议，且子集化（=修改）的合规性
   连厂商社区都没有确定答复。**中文保持 Noto Sans SC**（无合规替代品）。
3. **（已执行）视觉换新**：按「纯视觉偏好，与授权无关」的判断，2026 v2.2 完成
   拉丁 → **Public Sans**（26.1 KB，中立 Grotesque，OFL 无保留名）、
   等宽 → **Geist Mono**（33.8 KB，数字天然等宽，OFL 无保留名）。
   同步更新的六处：`theme/base.css` 的 `@font-face`、`theme/tokens.css` 的两条字体栈与
   非分层重申、`verify-theme` #6/#7 的栈名与文件名断言、#11 的许可证清单、#12 的审计表，
   以及 `DESIGN.md` §3.1/§3.2/§3.3/§3.4。
   换字后 `verify:all` 与 `verify:pages` 全绿；**已知覆盖缺口**见 §7。
4. **`frontend/public/licenses/` 是许可证的唯一权威位置**，不要再往 `src/assets/fonts/` 放 `.txt`。

---

## 7. 换字后的已知覆盖缺口与未验证项

**覆盖缺口**（`python tools/fonts/compare-coverage.py` 可复现）：

| 角色 | 丢失码位 | 是否真被界面渲染 |
|---|---|---|
| 拉丁（Archivo → Public Sans） | 12 个：`U+2009 U+2010 U+2011 U+2015 U+2017 U+2032 U+2033 U+203E U+2052 U+2191 U+2193 U+FEFF` | 只有 `U+2191 ↑` / `U+2193 ↓` 会渲染，且**仅限 `?primitives` 原语陈列页**的标题与说明文字（该页承担组件层门禁靶子职责，常驻保留）；其余 10 个全仓无渲染用法 |
| 等宽（JetBrains Mono → Geist Mono） | 4 个：`U+000D U+00AD U+2215 U+FEFF` | **全部无渲染用法**（`U+2215 ⁄` 除号斜杠界面未用） |

两种缺口都由字体栈的兜底族承接（`Helvetica Neue`/`Helvetica`/`Arial` 与 `Cascadia Mono`/`Consolas`），
不影响任何交付页面。若将来某个缺口码位要用在正式界面，两条路：把该字形从上游另一字重并入子集，
或在 `unicode-range` 之外单独声明一个只含该字形的补丁 face。

**未验证项（如实列出）**：

- **未逐条读中文厂商字体的自定义协议原文**（MiSans / HarmonyOS Sans / OPPO Sans / 阿里巴巴普惠体）。
  §3 的判定基于「自定义条款 + 子集化合规性未决」，而不是逐条比对结论——因为按 §1 的结论，
  这些字体本来就不该选，逐条读没有产出。
- **未验证 Source Han Sans SC / Noto Sans HK/TC 的独立子集体积**。它们是零授权成本的额外覆盖层
  （想覆盖繁体时可加），但与本次诉求无关。
- **`unicode-range` 未随换字改动**：三份 `@font-face` 声明的是拉丁/CJK 的**区块**，
  而实际覆盖是子集字符集，两者本就允许不等（`unicode-range` 只决定"谁来抢字"，不保证有字形）。
  若将来换 CJK 字体，`base.css` 的 `U+FF00-FFEF`（全角标点）不能漏。
- **`tools/fonts/compare-candidates.py` 依赖 `.font-work/upstream/` 下的上游字体**，该目录已在
  `.gitignore` 中（约 28 MB，可从各官方仓库重下，URL 见 §4 与各脚本 docstring）。
  换字后旧字体留存在 `.font-work/retired/`（同样不入库），`compare-coverage.py` 靠它做集合差。
- 本文件替代了先前由子代理产出的一版报告（该版因会话内 `web_fetch`/`pwsh` 均不可用，
  多数许可证条目只能标注为「未验证」）；现存版本的事实均为本机实读。
