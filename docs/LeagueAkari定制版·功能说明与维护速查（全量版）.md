# LeagueAkari 定制版 · 功能说明与维护速查（全量版 2026-09-12）

> 这是**唯一权威文档**，取代旧的《项目说明书》与《维护速查手册》正文。旧手册的逐条变更记录（10.1–10.38）
> 保留在《维护速查手册_历史变更归档.md》里，需要考古细节时再翻。
>
> 读者：下一个接手的 AI 会话，或将来的自己。用户是代码小白，不会命令行和 Git。
> 自 2026-09-12 起，日常流程改为「AI 在本地修改和验证 → Git 提交并推送 fork 的 dev → Actions 构建 → 用户下载安装验收」。
> 本文与历史归档现随代码保存在仓库 docs/，后续功能变更必须同步维护相关文档。
> 2026-09-12 已补充 §3.11 复盘台体验与准确性改进、验证结果；其它正文未另标日期的功能、样本结论和待办仍是 2026-09-04 的历史记录，不能视为本次重新验证。

---

## 0. 三十秒速览

**2026-09-12 本地接入基线**：`D:\LeagueAkari-dev` 的 1,657 个受版本管理文件已与 fork 的 dev 提交 `b95a15dfc992db664bda1e3ea7130094eebd0d1b` 对比，未发现修改或缺失。后续任务仍须获取当时的远端最新状态，保护本地未提交改动。

**2026-09-12 复盘台改进**：动手前工作区干净，本地与 fork 的 `origin/dev` 均为 `24050bcd2aedd9de824660c053db175b9299bbdb`。复盘台源代码已在该提交中，§8 中旧的“待上传”不再代表现状。本次围绕“页面粗糙、重点难找”调整信息顺序、地图定位和统计呈现，并修复片段重复、刷新缓存与版本筛选口径；详见 §3.11。未同步官方上游。

| 项           | 内容                                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 仓库         | https://github.com/waynetaotao-wq/LeagueAkari ，**dev 分支**（fork 自 LeagueAkari/LeagueAkari）                                                                                            |
| 用户         | 国服（SGP 可用），主玩劫中单、偶尔上单；单双排 超凡大师                                                                                                                                    |
| 交付         | AI 在 `D:\LeagueAkari-dev` 修改、验证并推送 fork 的 `dev`；核对同一提交的 **Typecheck**、**Build Releases** 和 Release 后，用户下载安装 `league-akari-win-x64.7z`。实际耗时以 Actions 为准 |
| 定制规模     | 2026-09-04 首版复盘台为 42 文件；本次修改集中于复盘目录、对应 i18n 与手册，未增加依赖/shard/窗口                                                                                           |
| 验证能力     | 2026-09-12 整仓 134 文件 / 907 项 Vitest 通过；node/web Typecheck、生产构建通过；真实 Vue/Naive UI 的 Storybook 页面已交互及截图检查。国服真实数据与 Electron 安装包实机运行未验证         |
| 最重要的纪律 | 见 §1.3——只传差异、动官方文件先拉最新、结构审计、断言替换、外部数据实证、如实说边界                                                                                                        |

---

## 1. 交付流程与纪律

### 1.1 标准流程（2026-09-12 起）

1. 在本地项目 `D:\LeagueAkari-dev` 工作。先阅读本文件与根目录 `AGENTS.md`，按需查阅历史归档；获取 fork 的最新 `dev`，核对本地未提交改动及历史交付记录。未经用户要求，不同步官方上游或覆盖现有定制。
2. 基于核对后的最新文件全文实施本次变更，优先使用项目的真实 Vitest / TypeScript / Vue 编译器和必要的构建、运行检查。只修改本次相关内容，测试预期应验证行为或契约，不能仅复述实现。
3. 同步更新本文件中受影响的功能说明、限制、测试方法和交付记录；需要保留逐条历史时追加到《维护速查手册_历史变更归档.md》。格式化本次文件并审阅差异，提交仅包含相关源码、测试、文档或必要配置。
4. 用户明确要求修改或修复时，默认由 AI 完成本地提交并推送到 `origin/dev`；仅检查、审查或提供方案的任务先交付报告。正常授权范围内无需用户逐步确认或手工上传；若 GitHub 要求登录或权限不足，明确说明具体需要用户完成的操作。
5. 推送前检查远端是否出现新提交；若整合了新代码，重新运行受影响的检查。禁止强制推送或丢弃本地工作。若仓库保护规则要求 PR，遵守规则。
6. 推送后核对本次提交 SHA 对应的 Typecheck、Build Releases 和 Release。失败时区分本次改动、既有问题与环境故障；未完成的步骤不能记为通过。正式交付应用改动时确认 Release 中存在 `league-akari-win-x64.7z` 并提供链接。
7. 用户下载安装后验收，页脚提交号应对应实际安装包。静态检查、单元测试、构建、真机验收和评分有效性是不同结论，分别记录。

不再要求生成差异 ZIP 或使用 `/mnt/user-data/outputs`，两本手册与代码一起提交。旧章节中的拖拽上传、旧环境路径和固定等待时长仅保留为历史记录。

### 1.2 GitHub 相关

- **Typecheck 工作流**：`.github/workflows/typecheck.yml`，与官方 `ci-release.yml` 同环境（checkout@v7、setup-node@v6、node 24、yarn immutable、corepack），触发 push[dev] + 手动；并发组独立不与 release 冲突。
- **Sync fork 告警**：历史记录中的官方更新与 4 个定制文件重叠（`window-manager/index.ts`、`lifecycle-controller.ts`、`renderer-shared/shards/window-manager/index.ts`、`store.ts`）；实际冲突范围需重新核对。**不要随手点 Sync**。用户明确要求同步官方时，由 AI 获取双方历史、三方合并并验证后通过 Git 提交，不在网页上丢弃定制提交。
- 文件改名或删除通过 Git 差异一并提交；只处理本次需求涉及的文件。历史网页拖拽流程不能删除文件的问题，不再作为现行交付方式。

### 1.3 纪律清单（每条都是踩坑总结）

- 改官方原有文件：**先获取 fork 最新状态并读取文件全文再改**，同时保护本地未提交定制，不凭记忆重写。
- UI 沿用官方风格与组件（naive-ui、官方 widgets、`[lolps]` 注释标记）。
- 交付前：括号配平（尊重引号/模板字面量）、Vue 模板标签配平、悬空声明四维度审计（const/let/function/import）、纯逻辑单测。
- 批量替换必须断言预期命中次数（只改一处时恰好命中一次），替换后核对落位。
- 外部数据契约能联网就实证（OP.GG JSON/网页、Bz 表、Data Dragon），不猜字段。
- 接口改了，**所有手工构造该结构的测试夹具都要跟着改**（10.28 的 Typecheck 红就是这个）。
- 图标库名字必须核实存在（unpkg 的 index.d.ts），或用仓库里已出现过的名字。
- 边界与限制如实告知；做不到的直接说。

### 1.4 日志与验收

- 日志：设置 → 调试 → 文件目录 → 日志目录；或安装目录 `logs/` 最新 `.log`。级别默认 info，定制代码的诊断全部 info/warn 可见。
- 常用关键字：`[lolps]`、`GameRefocus`、`MatchBuild`、`aux window`、`aux timing`、`render-process-gone`。
- 验收看什么：页脚 commit 哈希 = 最新构建；设置 → 杂项 出现新区块；对应场景真机行为。

---

## 2. 功能总览

| 功能                                        | 在哪看到                                                 | 开关 / 入口                | 核心文件                                                                                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **对位构筑（OP.GG 窗口）**                  | 选人/加载/对局中 OP.GG 窗口顶部"对位克制"区 + 各区块置换 | 对位替换开关（默认开）     | `src/main/shards/champion-data/{counter-intel,matchup-build}.ts`、`src/renderer/src-opgg-window/opgg/widgets/OpggCounterIntel.vue`、`matchup-overlay.ts`、`matchup-lifecycle.ts` |
| **Bz 劫攻略**                               | 玩劫时 OP.GG 窗口置顶卡片/区块；对局面板徽章             | 仅劫（238）自动            | `champion-data/bz-guide.ts`、`opgg/bz-overlay.ts`、`player-info-card/BzSummaryBadge.vue`、`bz-summary-zh.ts`                                                                     |
| **克制榜 / 单杀率**                         | OP.GG 窗口"对位克制"展开区                               | 随对位构筑                 | `champion-data/counter-intel-web.ts`                                                                                                                                             |
| **自动应用符文/召唤师/出装**                | 选人期自动写入 LCU                                       | 官方开关                   | `opgg/auto-loadout-queue.ts`、`opgg/context.ts`                                                                                                                                  |
| **默认地区/段位 = 韩国·翡翠+**              | OP.GG 窗口顶部下拉                                       | 一次性迁移                 | `champion-data/{state,index}.ts`、`renderer-shared/shards/champion-data/store.ts`                                                                                                |
| **大乱斗换取推荐**                          | 大乱斗选人期 OP.GG 窗口                                  | 自动                       | `opgg/widgets/OpggMayhemPicker.vue`、`opgg/utils/mayhem-picker.ts`                                                                                                               |
| **绝活研究**                                | 战绩页侧栏                                               | 手动开始                   | `player-tab/mastery-research.ts`、`widgets/MasteryResearch.vue`                                                                                                                  |
| **中单研究 v2**                             | 对局面板中单卡片，悬停展开                               | 自动（SGP + 中单位）       | `player-info-card/midlane-research.ts`、`PlayerInfoCardMidlaneResearch.vue`                                                                                                      |
| **对局评分（评分/MVP/SVP/标签/名次/成就）** | 战绩卡片、展开表、赛后弹窗                               | 无开关；权重可校准         | `match-card/utils/akari-score*.ts`、`widgets/AkariScoreBadge.vue`、`AchievementIcon.vue`、`shards/match-rating`                                                                  |
| **评分权重校准**                            | 设置 → 杂项 → 对局评分；战绩页侧栏"评分权重校准"         | 按钮                       | `utils/akari-score-calibration.ts`、`akari-score-calibrate-runner.ts`、`use-rating-calibration.ts`、`RatingCalibrateFromPlayer.vue`                                              |
| **赛后小结弹窗**                            | 结算时屏幕右下角                                         | 设置 → 杂项 → 赛后小结弹窗 | `window-manager/post-game-window/`、`src/renderer/src-post-game-window/`                                                                                                         |
| **复活自动切回游戏**                        | 对局中                                                   | 设置 → 杂项（默认开）      | `src/main/shards/game-refocus/`、`renderer-shared/shards/game-refocus/`                                                                                                          |
| **Mini 窗时机 + 黑屏自愈**                  | 大厅小窗                                                 | 官方开关                   | `window-manager/aux-window/window.ts`                                                                                                                                            |
| **团队之选窗口**                            | 独立窗口（默认关）                                       | 设置 → 杂项                | `window-manager/draftgap-window/`、`src/renderer/src-draftgap-window/`                                                                                                           |
| **自动举报**                                | 结算后                                                   | 官方举报开关               | `auto-gameflow/report-controller.ts`（Codex 重写，37 测试）                                                                                                                      |
| **对局复盘台**                              | 战绩页侧栏、展开战绩卡、赛后小结                         | 手动打开；历史分析手动读取 | `src/renderer-shared/components/review-studio/`，详见 §3.11                                                                                                                      |
| **Typecheck 预检**                          | GitHub Actions                                           | 自动                       | `.github/workflows/typecheck.yml`                                                                                                                                                |

---

## 3. 功能详解

### 3.1 对位构筑（OP.GG 窗口）

**是什么**：选人期推断敌方对位 → 直接请求 OP.GG 官方 JSON 接口（带 `target_champion`）→ 拿到对位专属的召唤师/符文/技能/出门装/鞋/核心装/装备七个区块，覆盖窗口里的通用数据；胜率、场次显示在"对位克制"区。

**数据链**（v3，`champion-data/counter-intel.ts` → `matchup-build.ts`）：

1. 并行请求 target 与无 target 的基线两份 JSON（`src/shared/http-api-axios-helper/opgg/index.ts` 的 `target_champion` 参数）。
2. **锚点校验**：对手在两份 `counters` 里的场次差 ≤ max(5, 10%)，否则拒收（快照漂移）。
3. **样本合理性**：各区块母体 = Σplay/Σpick_rate，与锚点场次对齐（[0.25M, 2.5M+10]）且相对基线缩小（≤0.5 倍、差 ≥ max(10, 0.5M)），至少两个区块通过才接受。
4. **无锚点路径（冷门对位）**：OP.GG 的 `counters` 只收前 60 个对手。对手不在其中时，改用"区块母体互证"（`estimateUnanchoredMatchup`）：≥2 个区块母体彼此对齐且相对基线显著缩小；最小样本 `MIN_UNANCHORED_MATCHUP_GAMES = 5`；对位胜负由召唤师技能区块各行汇总。
5. overlay 强绑定八维身份（英雄/对手/分路/region/tier/version/mode/source）+ gameId，旧局响应一律拒绝。

**生命周期**（`matchup-lifecycle.ts`、`OpggCounterIntel.vue`）：选人期推断（敌方 assignedPosition 唯一即采用）→ 加载后以真实阵容按位置校验（每 3 秒重试，最多 40 次）→ 全程锁定（含重连）→ 结算/大厅解锁。跨局用 champSelect session id + gameId 隔离；KeepAlive 切断、非活跃相位 reset。`effectiveLane` = 选人指派 → 对局内真实位置（`inGameLane`）→ 手动。

**界面**：展开区"已替换/未替换"标签行；状态行示例"已切换对位构筑 vs 艾克（OP.GG · 13 场 · 胜率 46%）"；单杀率不可用文案"暂无单杀率数据（该对位样本不足或数据源异常）"。

**默认地区/段位**：`ChampionDataSettings.preferences` 默认 `kr / emerald_plus`；`_migrateRegionTierDefaults()` 首次启动把存档里的官方默认 `global/all` 迁一次（标记 `regionTierDefaultsMigrated` 存原始存储键，**不能**放进 settingSchema——键受 `SettingPath<T>` 约束）。用户之后手动改什么就记什么。

**可调区**：`matchup-build.ts` 的对齐/缩减系数与 `MIN_UNANCHORED_MATCHUP_GAMES`；`OpggCounterIntel.vue` 的 IN_GAME_PHASES / 轮询次数。

**测试**：`matchup-build.test.ts`（18）、`matchup-build-unanchored.test.ts`（5）、`matchup-lifecycle` 相关（20）。

### 3.2 Bz 劫攻略

- 源：Google Sheets `BZ_SHEET_ID=1FInDZ2JhIyto2y-FnCcgCVlAYcjRaF7egcpsV41Spic` gid=1026317672 的 CSV，TTL 10 分钟，五个必需表头严格校验（Champion/Rune/Difficulty/Core Build/Summary），61 行，仅劫触发。
- 呈现：攻略卡（难度/符文/核心装/打法）、核心装置顶原生区（Data Dragon 只认 `maps[11]` 的峡谷装备，竞技场变体排除）、符文基石筛选、召唤师+出门装置顶、对局面板徽章（悬浮中文心得）。
- 召唤师/出门装：默认多兰剑+闪现点燃；例外（用户人工校对）——多兰盾：Aurora/Malphite/Syndra/Viktor；净化：Lux/Zoe；虚弱：Qiyana/Riven；传送：Malphite/Trynd。
- 中文词典 `bz-summary-zh.ts`：61 段预翻译，NFKC + FNV-1a 指纹锁定，英文一变即回落英文并提示"暂未翻译"。2026-09-01 复测 61 条指纹全部一致。
- 失败可见：源不可用/结构变化提示，不静默。

### 3.3 大乱斗换取推荐（`OpggMayhemPicker.vue`）

- 依赖 `window-manager-main/draftgap-window` 的 `getMasteries` ipc（无条件注册，与团队之选开关无关）。
- 熟练度在挂载时可能拉空（LCU 未连）：进入大乱斗选人期若仍为空则重试（`ensureMasteries`，在途去重）。

### 3.4 绝活研究（`mastery-research.ts` / `MasteryResearch.vue`）

- 拉目标玩家该英雄近 100 场（版本下拉来自实际战绩，新分析复位为全部版本），5 路并发时间线；序列守卫 + AbortController；卸载即中止。

### 3.5 中单研究 v2（`midlane-research.ts` / `PlayerInfoCardMidlaneResearch.vue`）

- 触发：SGP 可用 + 该玩家位置 MIDDLE + 有英雄。缓存 key `puuid:champion:sgpServerId`，TTL 30 分钟；依赖变化/隐藏/卸载中止在途（5 路并发不再后台空转）。
- 数据：版本梯队（当前 + 前两版，目标 500 场，翻页上限 60）→ 最近 60 场时间线。只收目标英雄、本人 teamPosition=MIDDLE、CLASSIC/map11/常规队列、≥300 秒且未提前结束的双方各 5 人局；队伍来自摘要 participantTeams，不用 participantId 范围猜。attemptedGames 是尝试数，deepGames 是有效时间线数，timelineFailures 单列失败；缺本人位置或早期窗口不完整不算「零游走」。
- **准确性边界**：时间线每 60 秒一帧坐标，只有击杀/建筑/野怪事件带精确坐标。首次游走精度 ±1 分钟，一分钟内往返的短游走可能漏。
- **游走判定（从严）**：只有身处严格边路走廊才算（上：x<3000∧y>5000 或 y>12000∧x<11000；下：y<3000∧x>4000 或 x>12000∧y<10500；龙坑/男爵坑/河道草排除）；连续同走廊帧合并为一段；走廊内本人参与的击杀不在任何段 ±60s 内则单独成段；成功 = 段 ±90s 内有本人参与击杀。起算 90 秒（`ROAM_START_MS`），统计到 14 分钟（`EARLY_MS`）。
- 其它统计：2–14 分钟位置点与击杀参与点（热力图，官方三分区）、分区权重、10:00 帧相对敌方中单（`enemyMidPid` 由 teamPosition=MIDDLE）的补刀差/经济差/领先率、单杀（无助攻主杀）、被单杀（仅中路带内）、14 分钟前参团率。
- 界面：打野研究同款——触发行热力小图 + "N 场 · 游走型/对线型/均衡（偏上/偏下）" + 分区权重 + 10 分钟经济差；悬停面板 140px 地图 + 地图偏好/游走/对线/前期参团四区块 + 算法与精度说明。复用官方 `GankMap`、`JunglePathingSection`。
- 画像规则：场均游走 ≥1.2 或中路占比 <62% → 游走型；场均 <0.6 且中路 ≥75% → 对线型；去向某一侧 ≥60% 标"偏上/偏下"。
- 已上传修复口径：10 分钟对线差仅接受 10:00 ±5 秒的有效双方快照；事件点需附近本人坐标佐证才支持游走判定，远程助攻不能证明到场；死亡/基地快照不进入地图偏好。首次单杀等级结合 LEVEL_UP 及同时间戳事件顺序，不能将击杀后的升级倒算。
- 测试：`midlane-research-v2.test.ts`、`midlane-research-abort.test.ts`；旧 4/2 项计数已过时，本轮与评分/赛后合计 80 项回归。

### 3.6 对局评分系统

**目标**：每局每人 0–10 内部评分，界面按自定义 WeGame 式量表映射显示（并非 WeGame 官方评分）；MVP/SVP、对局标签、全场名次、成就徽章。全程离线，只读战绩摘要。与官方绝对量表 "Akari Score"（`computeSingleAkariScore`）**无关**，文件名沿用 `akari-score`。

**入口**：`match-card/context.ts` 的 `akariScores`（折叠卡片、展开表共用），`PostGameView.vue`（赛后弹窗）——三处使用同一引擎；只有同数据、同模式、同权重时才应一致。赛后 LCU 暂评字段较少，与 SGP 战绩结果可能不同。

**数据提取**（`akari-score-input.ts`）：统一层参与者 + 原始摘要。SGP（国服）：免伤、坐牢时长、给队友治疗/护盾、目标伤害、投降/一血/最大连杀、`challenges` 里的有效治疗护盾、龙/男爵/先锋参与、对线补刀/等级领先、控制守卫、排眼、定身、镀层、推塔、抢龙、队友挂机；LCU 只有子集，缺项自动剔除。

**口径分流**（`resolveAkariScoreMode`）：CLASSIC→`sr`；ARAM→`aram`；**KIWI（海克斯/符文大乱斗）→`mayhem`**；CHERRY→不评分；其它模式 mapId 11→sr，否则→other。只有 sr 做位置推断与位置基线；保留已知位置，只给未知者补尚未占用的打野/辅助，不能辨别的上/中/下继续 UNKNOWN。非峡谷模式全员 UNKNOWN；aram/mayhem/other 各用固定权重表（`AKARI_ARAM_WEIGHTS` / `AKARI_MAYHEM_WEIGHTS`）。`weightsForSample()` 是唯一权重入口。

**指标（12 项，1.0 = 本局期望）**：输出、坦度（承伤+免伤）、支援（给队友治疗+护盾）、参团、生存、经济、补刀、视野（视野分 0.7 + 控制守卫/排眼 0.3）、控制（时长 0.6 + 定身 0.4）、目标（目标伤害 0.5 + 史诗野怪 0.3 + 镀层/推塔 0.2）、对线（补刀领先/40 + 等级领先/4）、效率（每金伤害）。

- **份额口径 `shareScope='game'`**（默认）：输出/支援/目标/参团/死亡/坐牢/镀层的分母是"全场总量 ÷ 队数"——打得少的队整体份额低，胜负效应来自真实表现。坦度保留本队口径。
- **期望**：`pairBlend=0.25` 的同位置对手均值 + 0.75 的位置基线（`AKARI_POSITION_BASELINES`：五位置在份额/倍率上的典型值）；经济/补刀纯对线口径；位置未知退回全场均值。
- **生存曲线 `inverse`**：1/(0.5+0.5·死亡倍数)——0 死 2.0、平均 1.0、两倍 0.67、三倍 0.5。
- 单项比率上限 2.5；单杀/多杀/抢龙微加成 ≤0.35。
- 已上传修复：可选指标按可比范围的字段完整性剔除或回退，不把未提供字段算成零表现；有效治疗或护盾分量可独立保留。

**权重**：`AKARI_POSITION_WEIGHTS`（六组，行和 = 1）。2026-09-03 用 7 局顶尖对局（70 人）对照 OP.GG OP Score 调整：参团 +.05、生存 +.04、补刀 −.04、经济 −.03、效率 −.02；当时记录的排名一致性（斯皮尔曼）0.53 → **0.872**，MVP 6/7 一致。仅属历史小样本对照，本轮未重新实证，不能说明普遍准确、适合所有英雄分段，或剩余分歧仅属口味。对照脚本归档在 `/home/claude/_deprecated/opgg-bench.ts`（含 70 人数据）。

**映射与量表**：composite → `5+5·tanh(2.5·(c−1))` 得内部 0–10；显示 `clamp(7.5+(r−5)×1.98, 0, 17.4)`——内部 5 映射 7.5，内部满分映射 17.4；7.5 是映射中心，不保证每局实际平均为 7.5，亦非官方 WeGame 分数。

**徽标与标签**：

- MVP = 全场最高；SVP = 败方最高（与 MVP 重合只记 MVP）。
- 标签（`AKARI_TAG_THRESHOLDS`，显示分）：挂机局（己方有挂机，整队，优先级最高）；赢：Carry 局 = ≥11.0 且领先队内第三 ≥1.25 内部分（前两名可同时成立）、躺赢局 = ≤6.0 且低于队友均值 ≥1.0、碾压局 = 队伍经济比 ≥1.25 或（≥15 杀且击杀比 ≥2）或（投降且 ≤25 分钟且经济比 ≥1.12）且非前两者；输：尽力局 = ≥10.0、甩锅局 = ≤5.0 且全队最低且低于队友均值 ≥1.0 且队友均值 ≥4.5（整队崩盘不扣帽子）。任一队伍 <3 人不打标签。
- 名次：`rank` 1..N；MVP/SVP/名次统一稳定排序：内部分→参团→输出→puuid。名字旁"第N名"（前三金色，MVP 不重复）。
- 成就（`akari-achievements.ts`，17 种）：全场唯一最大且 >0 才发，击杀 ≥5、助攻 ≥8，零死亡需 ≥15 分钟；FontAwesome 图标（`AchievementIcon.vue`，名字已核实）+ 悬停外号与说明（击杀王/输出王/承伤王/助攻王/补兵王/财神/拆塔王/视野王/奶妈王/控制王/参团王/一血/超神/五四三杀/零死亡）。
- 重开/提前投降局不评分；单人队伍生存项防 NaN。

**校准（数据驱动权重）**：设置 → 杂项 → 对局评分 →「校准（最近 400 场）」，或任意玩家战绩页侧栏「用他的战绩校准」。读峡谷 5v5 常规队列（420/440/400/430/490、≥8 分钟、非重开）→ 按位置 L2 逻辑回归（特征标准化、400 轮）→ **β/std 还原原尺度** → 系数非负部分归一 → 向先验收缩 n/(n+300) → UNKNOWN 取五位置均值。少于 20 个有效对局不保存。

达到 `CALIBRATION_VALIDATION_MIN_GAMES=60` 个去重对局后，按接口新到旧顺序把前 ceil(20%) **整局留出**，其余用于拟合；同局不跨组，验证后不再全量重拟合。`trainingAccuracy` 是训练集胜负分类准确率；`winnerHigherRate` 是留出局中唯一同分路双方「胜方最终评分更高比例」（平分计 0.5），同时给出内置权重的 `priorWinnerHigherRate`。二者都不是「个人贡献评分准确率」；少于 60 场不声称有独立验证。

`StoredCalibration.version=2` 保存 `trainingGames/totalSamples/report/validation`；旧 v1 或损坏数据回退内置权重，需重校。保存或恢复后卡片及赛后评分响应式重算；换号仍全局生效，但不保证对新账号、英雄或分段合适。高手战绩只是一个样本来源，不等于得到「顶尖标准」。

**显示位置**：折叠卡片"补刀"右侧评分列（分数+徽标+标签+名次，悬停拆解各项倍数与口径）；展开表位置标签旁；赛后弹窗。

**测试**：`akari-score.test.ts`、`akari-score-input.test.ts`、`akari-score-calibration.test.ts`、`akari-score-calibrate-runner.test.ts`、`akari-achievements.test.ts`、`match-card/context.test.ts`；当前与中单及赛后摘要测试合计 80 项通过，旧逐文件计数不再适用。

### 3.7 赛后小结弹窗（`post-game-window`）

- 独立窗口（照团队之选模板）：440×780，不可缩放、跳过任务栏、默认置顶、暗色钉死。结算（PreEndOfGame/EndOfGame）自动弹在主屏工作区右下角（`_moveToBottomRight`，`showOrRestore(true)` 不抢焦点）；回大厅保持；关闭 / 自动收起（默认 120 秒，可选 60/120/300/不收起）/ 进入选人或对局时隐藏；LCU 断连隐藏。
- 数据：`post-game-summary-loader.ts` 每 3 秒轮询最多 20 次，优先 SGP；取得 LCU 后先显示暂评并继续等同局 SGP，成功后升级。包装及原始 gameId 都须匹配，取消后不发布旧结果。若一直只有 LCU，分数可能与 SGP 战绩不同。
- 界面：英雄原画头图（`resources.assets.resolve('/lol-game-data/assets/v1/champion-splashes/{id}/{id*1000}.jpg')`）、68px 头像带金/银环、名字 + 第N名、胜负大圆徽、三列大字（时长 / 评分 / KDA）、本人标签芯片与成就徽章；我方/敌方列表每行 42px：头像（底部 MVP/SVP 标牌）、名字 + 第N名 + 位置、标签芯片与成就、KDA、评分；队伍标题带 K/D/A 合计；脚注显示口径（召唤师峡谷/极地大乱斗/海克斯大乱斗）与数据源。
- 登记点：`electron.vite.config.ts`（alias + rollup input）、`tsconfig.web.json`（include，纳入类型检查）、主/渲染 window-manager 五处。

### 3.8 复活自动切回游戏（`game-refocus`）

- 对局中每秒（死亡后 0.5 秒）轮询 Live Client Data API `playerlist`，本人 `isDead/respawnTimer`；`RespawnRefocusTracker` 每次死亡只触发一次，剩余 ≤2 秒（`GAME_REFOCUS_LEAD_SECONDS`）或错过窗口补一次。
- 切回：PowerShell `-EncodedCommand`（UTF-16LE Base64）执行 `AppActivate(pid)`，失败兜底 user32 `ShowWindowAsync+SetForegroundWindow`；**不含任何按键/鼠标模拟**（单测明文断言）；8 秒超时；同一死亡 5 秒内不重复；前台已知且在游戏里则跳过（判断需管理员；不可判断时激活等价无操作）。
- 只在 InProgress 且开关开且 Windows；观战找不到本人不动作；结算/重连/关开关停止并复位。
- 设置 → 杂项 →"复活自动切回游戏"（默认开）。日志 `[GameRefocus] activated game window pid=…`。真机实证：一局 4 次成功 1 次已在前台跳过。
- 独占全屏偶发只闪任务栏（系统前台锁），建议全屏窗口化；不用"先按 Alt"手法。

### 3.9 Mini 窗（aux window）时机与黑屏自愈

- 时机：选人/加载/对局隐藏；大厅/匹配/准备检查显示（`backgroundColor '#141416'` 垫黑底）。
- **黑屏根因（日志实证）**：窗口曾被最小化、随后选人期被 hide；回大厅基类 `showOrRestore()` 见"已最小化"只 `restore()` 即返回——系统认为可见但 Chromium 未走真正 show 流程，内容黑。
- **v4 修法**：凡"从隐藏态回来"（`_hiddenByTiming`）由 aux 自行处理：最小化则 `restore()`，随后**一律 `show()`**；显示后 `invalidate()`、1px 尺寸往返（`_nudgeWindowSize`）、800ms 后自检（`isCrashed()` / `innerText` 为空 / 截屏亮像素 <1% → 重载）。每次时机判定与显示动作都打 `[lolps] aux …` 日志。
- 待真机验证（v4 上传状态见 §8）。

### 3.10 团队之选窗口 / 自动举报 / 其它

- 团队之选：独立窗口（默认关），`draftgap-window/service.ts` 提供 `getMasteries` 等 ipc（无条件注册）。
- 自动举报：`auto-gameflow/report-controller.ts`，Codex 重写，37 测试。
- OP.GG 窗口顶部 KeepAlive、`OpggChampion.vue`/`OpggView.vue` 的对位元信息显示等小改。

---

### 3.11 对局复盘台（2026-09-12 体验与准确性改进）

四项功能在一个 Naive UI 弹窗内联动：**关键片段、对位档案、时间线地图、领先兑现**。入口先展示本局值得关注的事实，再进入详细回看；沿用当前主题的颜色与组件。统计相关性不作为比赛输赢的原因，既有评分公式保持原口径。

**入口与使用**：

1. 玩家战绩页侧栏 →「个人复盘台」→「打开复盘台」。展开合格的峡谷战绩卡片，也可点「关键片段与地图复盘」直达该局。
2. 赛后小结会读取该局的关键片段，按钮可在主窗口打开完整复盘。赛后小窗只预览，不写入长期档案。
3. 单局页可点「读取历史列表」选择实际已读的对局；尚未选择时提供最近对局列表。历史读取为空、正在读取、不可用和读取失败分别显示。
4. 「单局复盘」分为「本局重点」「时间线与地图」「数据明细」。重点页优先使用有效的 15 分钟快照，缺失时退到 10 分钟；显示真实经济/补刀差及优先回看的问题。点击重点片段直接滚动到地图，赏金片段定位该组中已记录赏金最高的死亡；详细依据位于地图下方。数据明细保留 10/15/20 分钟实际快照与完整性说明。
5. 「对位档案」「领先兑现」的历史筛选可折叠，开始分析后收起，结果显示在前。最多手动扫描最近 500 场摘要；按英雄、位置、对位、队列、版本筛选后，分析最近 20 / 40 / 60 场时间线。默认优先实际存在的劫中单、单双排及所选队列最近版本；切换队列会校正已不存在的版本选项。选择全部队列/版本后，实际混合的样本会提示环境差异。
6. 档案默认展示本机积累，开始分析后切到本次结果；可按交手最多、15 分钟最落后或最近交手排序。均值和有效样本数直接显示，分布细节点击「查看分布」。展开的对位、输入中的笔记和领先条件在页签之间保留。

**四项功能的口径**：

| 功能       | 实际输出                                                                                                                                    | 精度和限制                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 关键片段   | 经济优势建立/扩大或收缩、终结赏金死亡、3 分钟内重复死亡、死亡后 90 秒内敌方获得建筑/史诗野怪；死亡按组归并，每局最多 5 条，附时间与事实依据 | 规则筛出的复盘线索和待核实问题；死亡与后续目标仅为时间关联，不称为因果或「送掉比赛」。没有命中也不代表没有失误                 |
| 对位档案   | 10/15 分钟相对敌方同位置的经济与补刀差、胜率、有效样本数、范围与样本标准差；最近与此前两组等量且互不重叠，最多各 20 局；可打开原始对局      | 对位位置必须双方各自唯一；无法确认的对位不猜。各指标独立计算有效样本分母，未知值不填 0                                         |
| 时间线地图 | 原版峡谷地图与英雄头像、逐帧前进/后退、播放/暂停、速度选择、事件过滤；点击关键片段或经济曲线会定位到对应时间                                | 地图是服务器离散快照，通常约 60 秒一帧；精确事件时间不等于同一时刻十人的真实位置。不插值伪造连续移动，不提供技能或完整操作回放 |
| 领先兑现   | 在 10 或 15 分钟个人领先 ≥500 金，或团队领先 ≥1500 金的比赛中，查看赢输、之后的实际快照、自身死亡和敌方目标事件                             | 明确筛选门槛，不是能力评分；混合队列/版本时界面提示。记录不完整时显示「已记录」，不能据此断言「没有发生」                      |

**新分析引擎的从严校验**：

- 仅 CLASSIC、地图 11、队列 420/440/400/430/490、时长至少 5 分钟、非重开/提前结束的正常 5v5。
- 对局编号、摘要与时间线参与者身份、团队和人数必须一致；用 participantId 找人，不拿数组下标当身份。
- 10/15/20 分钟指标仅采用目标时刻 ±10 秒内的真实帧，显示实际时间；本方/敌方总经济必须两队十人数据齐全。零是真实零，缺失保持空值。
- 帧间隔超过 75 秒时，经济图断线且地图显示间隔提示，不跨缺口识别经济变化。个人/团队经济差在 2–5 分钟内从领先收缩 ≥750/2000 金，或增加 ≥750/2000 金且结束时为正，才产生对应线索；个人和团队不会因为共享事件而互相去重。经济图默认展示片段对应口径，无片段时优先个人口径。
- 死亡组以首个死亡为起点，最多涵盖其后 3 分钟的死亡；同一死亡不重复生成赏金、连续死亡、资源关联三条提示。组内已记录的额外赏金只累加一次；关联目标不反过来合并不同死亡组。
- 地图筛选与事件列表使用同一范围和类型条件；点击事件突出其记录坐标，英雄仍显示最近的前序快照，明确两者的实际时间差。英雄列表折叠显示，播放在切换视图、隐藏和卸载时停止。
- 建筑事件的 teamId 代表被摧毁建筑所属队，归属进攻队时必须反转；击杀「终结赏金」只认 shutdownBounty。
- 去重重复事件，并用摘要中每人的死亡数核对时间线中的受害者记录；发现不一致标注事件不完整。这不保证所有非击杀事件均可被外部独立校验。

**数据与生命周期**：

- 沿用现有 SGP 客户端、已配置端点和登录凭据；显式传目标区服与取消信号。非国服跨区不可用时提前说明，国服跨区仍取决于服务端权限。
- 每个渲染进程最多 3 个并发请求；排队请求也能取消。换账号、换研究对象/区服、关闭弹窗或不可用时中止旧任务，旧响应不得更新新页面。
- 成功缓存按区服/玩家/对局隔离，最多 120 局、15 分钟；不缓存时间线或事件不完整的结果。「重新读取」会同时重取摘要和时间线，并废弃旧缓存。成功后同步更新地图、候选元数据、当前批次统计和档案；失败明确提示，同局保留已取得的画面供查看，切换到另一局时清除旧画面，不能把旧结果当成刷新成功。
- 摘要筛选、时间线解析和旧档案读取共用版本归一化（主版本.次版本，缺失为“未知”），避免候选已入选、分析后却因空版本被排除。
- 本机精简档案最多 200 局，使用既有 SettingUtils 存储，按本人账号及区服、研究对象及区服隔离；仅保存元数据、10/15/20 分钟快照和必要事件，不存完整十人轨迹。重新回看地图需重新读取时间线。
- 笔记额外按英雄、位置、对位英雄隔离，最多 4000 字符；延迟读取不能覆盖已输入内容，保存串行化且失败可重试。读取未完成或失败时只读，避免覆盖未知旧笔记。
- 所有长期档案写入由主窗口完成；换身份或取消时已经成功的局仍写入捕获的原作用域，不能混入新账号。

**文件索引**（下列文件除注明者均位于 `src/renderer-shared/components/review-studio/`）：

- 纯逻辑：`types.ts`、`analysis.ts`、`statistics.ts`、`review-insights.ts`；测试夹具 `test-fixtures.ts`。
- 读取与持久化：`data-loader.ts`、`use-review-data.ts`、`archive.ts`、`notes.ts`。
- 入口：`ReviewStudioHost.vue`、`ReviewStudioEntry.vue`、`PostGameReviewEntry.vue`、`link.ts`、`use-open-review-studio.ts`。
- 容器/历史/档案：`ReviewStudioModal.vue`、`ReviewHistory.vue`、`ReviewMatchups.vue`、`ReviewLeadAnalysis.vue`、`ReviewTrend.vue`、`ReviewMetricCard.vue`、`ReviewNote.vue`、`review-display.ts`、`review-selection.ts`。
- 单局联动：`ReviewMatchView.vue`、`ReviewOverview.vue`、`ReviewTimeline.vue`、`ReviewMoments.vue`、`ReviewGoldChart.vue`、`review-view-utils.ts`、`review-view-text.ts`。
- 界面预览：`ReviewStudio.stories.ts`，包含完整单局、历史、数据缺失、空历史和不可用场景；只用演示数据和内存存储，不连接 SGP 或保存用户笔记。新增文案位于 `src/shared/i18n/{zh-CN,en}/renderer/review-studio.yaml`，由既有 renderer i18n 入口加载。
- 首版接入的主窗口 `App.vue`、战绩侧栏 `PlayerTabSidebarContent.vue`、战绩卡 `MatchHistoryCard.vue`、赛后 `PostGameView.vue` 本次未改。卡片虚拟化及入口继续使用；没有新增依赖、shard、窗口或构建配置。

**2026-09-12 本地验证**：实际仓库 Vitest 全套 **134 文件 / 907 项通过**，其中复盘模块 **11 文件 / 86 项**；覆盖身份/数据完整性、片段去重与缺口、版本筛选、刷新与失败恢复、笔记/档案隔离及时间线播放生命周期。整仓 node/web Typecheck（含 noUnusedLocals/noUnusedParameters）与 `electron-vite build` 主进程、预加载及全部渲染窗口构建通过；本次文件使用仓库 Prettier 格式化并检查 Git 差异。真实 Vue/Naive UI Storybook 页面已在本地浏览器完成深色/浅色、较窄窗口、重点定位、事件筛选、历史分析、页签/笔记保留和缺失数据的交互及截图检查。

**尚未完成的验证**：本次没有连接用户国服客户端读取真实对局，Storybook 演示数据不能证明 SGP 实际字段完整或规则符合人工复盘结论。本地原生依赖重建因缺少 Visual Studio C++ 工具链未完成，因此没有把浏览器预览称为 Electron 安装包实机验收；安装包由本次提交的 Actions 构建并核对 Release。生产构建仍存在既有 ChampionIcon 的 `@reference` 警告及大分块提示，退出码为 0。

**用户安装后验收**：

1. AI 提交并推送 dev 后，核对该 SHA 的 Typecheck/Build Releases 和 Release；用户直接下载提供的 `league-akari-win-x64.7z`，核对页脚提交号，无需手工上传源码。
2. 打开一局合格的劫中单战绩，确认时间、英雄、胜负一致；重点页应先显示实际对位差和优先片段。点击片段应直接看到地图和选中事件，核对其实际时间差；数据明细中区分未达到的时间点与缺失快照。
3. 播放地图后切换页签、关闭复盘台或切到后台，确认停止播放；缺失帧应显示提示，不应连成连续走位。
4. 手动读取历史，按版本/队列分析 20 局，检查成功/失败/有效样本数；取消后继续，已成功结果应保留。
5. 在某个对位写笔记，关闭后重开应保留；换对位/研究对象不能串笔记。网络断开时已有精简档案仍能查看，但重新拉地图会给出不可用或失败提示。
6. 查看领先兑现的赢局/输局，点开原始对局，核对 10/15 分钟门槛与实际时间。完成一局后检查赛后关键片段入口能打开主窗口。

---

## 4. 数据源与外部契约（2026-09-01 联网复测全部成立）

| 源                                                                                                           | 用途                                           | 契约要点                                                                              | 失效表现                                              |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| OP.GG JSON `lol-api-champion.op.gg/api/{region}/champions/ranked/{champ}/{pos}?tier&version&target_champion` | 对位构筑、通用构筑                             | target 生效（对位样本 847 vs 通用 15939）；七区块；version 参数有效；counters 仅前 60 | fail-closed 回通用，状态行说明                        |
| OP.GG 网页 `op.gg/lol/champions/{c}/counters/{pos}?target_champion=`                                         | 单杀率                                         | 锚点 `Lane kill rate`，Flight/HTML 两路径                                             | "暂无单杀率数据"                                      |
| Bz Google Sheets CSV                                                                                         | 劫攻略                                         | 五表头、61 行、指纹                                                                   | 源不可用提示，英文回落                                |
| Data Dragon `versions.json` / `item.json`                                                                    | 装备 id、图标                                  | `maps["11"]`、purchasable                                                             | 保留文本攻略                                          |
| Riot Live Client Data（127.0.0.1:2999）                                                                      | 复活切回                                       | `playerlist[].isDead/respawnTimer` 官方公开接口                                       | 静默等待                                              |
| SGP（国服）                                                                                                  | 战绩摘要/详情/时间线、评分、校准、研究、复盘台 | 已配置端点及凭据；字段须逐项校验，不能假定完整                                        | 评分/赛后可用 LCU 暂评；复盘台时间线不以 LCU 伪造补全 |
| LCU                                                                                                          | 相位、召唤师、单局战绩、资源                   | —                                                                                     | —                                                     |

在中国大陆访问 Google/Data Dragon 依赖代理；主进程用统一 HTTP 客户端继承代理设置。

---

## 5. 安全边界（反作弊相关，改动时必须保持）

- 允许：读 LCU/SGP/Live Client 官方接口、操作系统层窗口激活（等价 Alt+Tab）、只读战绩计算。
- 禁止：读游戏内存、注入、**模拟任何按键/鼠标到游戏**（复活切回明确不用"先按 Alt"手法；`refocus-logic.test.ts` 断言脚本不含 SendKeys/keybd_event/SendInput/mouse_event）。
- 不做：敌方召唤师技能/大招计时（Riot 现行第三方政策明文禁止"追踪敌方召唤师技能冷却或以计时器辅助追踪"，自动与手动皆在禁止之列；原版自带的手动 CD 计时窗同样踩线，排位不建议开）。

---

## 6. 测试与验证方法

### 6.1 仓库内测试（Actions 不跑 vitest，靠本地/Codex）

`src/**/*.test.ts` 共约 900+ 项（官方 723 + 定制）。定制测试文件：`matchup-build*.test.ts`、`bz-guide.test.ts`、`bz-summary-zh.test.ts`、`BzSummaryBadge.test.ts`、`matchup-lifecycle*.test.ts`、`refocus-logic.test.ts`、`akari-*.test.ts`、`midlane-research-*.test.ts`、`report-controller*.test.ts` 等。

### 6.2 历史无依赖时的临时验证（不能替代实际工具）

本轮已安装真实依赖并使用 Vitest 4.1.10、TypeScript 6.0.3、vue-tsc 3.3.9、Vue 3.5.40，正式构建使用 Vite 8.2.0。以下仅保留旧环境操作记录；不能把 any/垫片结果称为整仓类型检查。

- `node --experimental-transform-types --no-warnings xxx.ts` 可直接跑纯 TS（参数属性需 transform 模式）。
- vitest 垫片：`/home/claude/t7/vitest-shim.ts`（describe/it/it.each/expect 常用匹配器），用 sed 把 `from 'vitest'` 与相对路径改到垫片/仓库文件即可跑（示例：`/home/claude/t7/*.test.ts`）。
- 依赖 `@shared/...` 别名的适配器：拷到沙箱改成相对路径 + 类型别名 any（`/home/claude/t7/adapters/`）。

### 6.3 结构审计（每次交付前）

- 括号配平：忽略字符串/模板字面量/注释；
- Vue 模板标签配平：尊重引号的标签扫描（`:class="a>b"` 不误报）；
- 悬空声明：const/let/function/import 四维度清点，配合真实 TS/Vue 语义检查的 noUnusedLocals/noUnusedParameters；Vue 模板引用与跨文件导出须按真实语义处理，不能仅靠「全文出现一次」判断。
- 本轮 42 个源文件解析结果：const 726、let 42、function 124、import 265，语法错误 0；两套整仓 Typecheck 均零诊断。

### 6.4 真机验收清单

- 页脚 commit 哈希；设置 → 杂项 区块；OP.GG 窗口默认韩国/翡翠+；冷门对位（如艾克上单）能切换；赛后弹窗右下角；复活切回日志；Mini 窗回大厅正常（含先最小化再打一局）。

---

## 7. 已知问题与待办

- Mini 窗黑屏 v4 待真机验证（先最小化再打一局回大厅）。
- 评分：历史 7 局对照不足以证明极高准确性，仍需更广样本、英雄/位置分层和人工复盘。位置基线、英雄基线尚非历史数据学习；新复盘台提供时间线事实，但本次未把这些信号并入评分公式。
- 标签阈值为人工设定，可做"按本人历史分位数"的数据驱动阈值（未做）。
- 海克斯大乱斗仅有专用权重档，未做强化去噪（用户明确不需要）。
- 官方 dev 有 2 个未同步提交（macOS 材质等），4 文件重叠，需三方合并。
- 中单研究和复盘台地图都受服务器离散快照限制；无法重建分钟内完整走位和操作。
- 2026-09-12 复盘台已做界面及规则改进，本地全套测试、类型、构建和 Storybook 浏览器验收通过；交付通过 Git 推送并核对对应 Actions/Release。Windows 安装包实机、国服真实对局和人工复盘准确性仍待验收，详见 §3.11。

---

## 8. 交付包清单（2026-09-01 至 09-04，按时间）

> 以下是历史记录，表中的“当前 dev”“本轮”“待上传”指当时状态。本次手册入库未逐项重审各旧包；新任务必须用实际提交和文件差异核对，不能直接据此覆盖代码。2026-09-12 起的交付以 Git 提交和同一 SHA 的 Actions / Release 为准。

| 包名                                         | 内容                                                                  | 上传状态                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| lolps-fix-2026-09-01                         | 中单研究取消、绝活卸载中止、大乱斗熟练度重试、缓存 TTL                | ✅ af07d92 绿                                                                |
| lolps-feat-game-refocus                      | 复活自动切回                                                          | ✅ f331556 绿                                                                |
| lolps-fix-2026-09-01b                        | 冷门对位无锚点验证 + 分路显示 + Mini 自愈 v1                          | ✅                                                                           |
| lolps-fix-mini-black-v3                      | Mini 诊断日志 + 强制显示                                              | ✅                                                                           |
| lolps-feat-rating-and-postgame（大包，超集） | 评分 v3 + 校准 + 赛后弹窗 + 标签 + 量表                               | ✅（分批）                                                                   |
| lolps-fix-typecheck-calib-test               | 校准测试夹具补字段                                                    | ✅                                                                           |
| lolps-fix-postgame-v2                        | 头图/成就（FontAwesome）/NaN/小规模不打标签/位置归一                  | ✅                                                                           |
| lolps-fix-default-kr-emerald                 | 默认韩国·翡翠+ 与一次性迁移                                           | ⚠️ 待确认                                                                    |
| lolps-fix-aram-mode                          | 四路口径分流（含 KIWI）                                               | ⚠️ 待确认                                                                    |
| lolps-fix-postgame-v3                        | 窗口 440 宽、成就悬停外号、MVP/SVP 头像标牌                           | ⚠️ 待确认                                                                    |
| lolps-fix-scoring-vs-opgg                    | 全场份额口径 + 生存曲线 + 权重微调 + 全场名次（4 文件，最新版含名次） | ⚠️ 首版已传，含名次的最新版待确认                                            |
| lolps-fix-mini-black-v4                      | Mini 黑屏最终修法                                                     | ⚠️ 待确认                                                                    |
| lolps-feat-midlane-v2                        | 中单研究 v2（算法从严 + 打野同款界面）                                | 已在本轮核对基线中存在，并包含后续修复；勿重传旧包                           |
| lolps-fix-midlane-rating-2026-09-04          | 中单/评分/校准/赛后修复，18 文件                                      | ✅ 用户已上传，当前 dev 为 631e3c9                                           |
| lolps-feat-review-studio-2026-09-04          | 关键片段、对位档案、时间线地图、领先兑现；42 文件                     | ⏳ 本轮交付，待用户上传和真机验收；本地 155 测试、双 Typecheck、生产构建通过 |

历史待确认标记仅是旧记录，不能据此重传旧文件。多个包存在相同文件的连续改动，**上传顺序并非无所谓**：本次 42 文件包基于 `631e3c9`，保留该基线中的修复；只上传本次包。若下次 dev 已变化，先读最新全文/对照差异再改。

本包 ZIP：`lolps-feat-review-studio-2026-09-04.zip`，99,688 字节；SHA-256：`c3465a76d350f2305d3b65eb3fb3cdbcb49fe00f2276e4348f0575cbab54d6b3`。仅含 `src/...` 下 42 文件，其中 10 个测试文件；不含文档、依赖、构建产物或临时预览。逐文件已与经过验证的工作树核对。

---

## 9. 教训图鉴（编译与运行时）

1. **TS6133 悬空**：四维度审计（const/let/function/import）。
2. **接口改了测试没跟**：`AkariMetricSample` 加字段 → 校准测试夹具 TS2345 红（10.28）。所有手工构造该结构的地方一起改。
3. **类型化 settingSchema 键约束**：`SettingSchema<T>` 键 ⊂ `SettingPath<T>`，迁移标记之类的临时键用 `_getFromStorage/_saveToStorage`。
4. **TDZ**：computed 引用后定义的常量运行时通常无事，但若中间有 immediate/sync watcher 会踩；常量上提。
5. **图标库名字**：不核实就用会红；无法联网时用仓库已出现的名字或先做别的。
6. **模板可空访问**：v-if 用中间 computed 不收窄，直判本体。
7. **新语法无先例**：`??=` 等先确认仓库里有先例。
8. **SGP 字段位置**：顶层与 `challenges` 分开（后者有索引签名，任意键 `number|undefined`）。
9. **Vue 基类守卫**：`showOrRestore` 见最小化即返回——"最小化 + 隐藏"要自己 restore+show。
10. **模式代号**：海克斯大乱斗是 `KIWI` 不是 `ARAM`；斗魂竞技场 `CHERRY`。
11. **份额口径**：本队份额让输方账面和赢方一样好看——按全场份额才有胜负效应。
12. **纯对位比较**：对手越菜分越高，须与位置基线混合。

---

## 10. 关键常量速查（可调区）

| 常量                                                                             | 位置                                 | 当前值                                                                                                    | 含义             |
| -------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------- | ---------------- |
| `AKARI_SCORE_ALPHA`                                                              | akari-score.ts                       | 2.5                                                                                                       | tanh 陡峭度      |
| `AKARI_METRIC_CAP`                                                               | akari-score.ts                       | 2.5                                                                                                       | 单项比率上限     |
| `AKARI_RATING_DISPLAY_MAX / _CENTER`                                             | akari-score.ts                       | 17.4 / 7.5                                                                                                | 显示量表         |
| `AKARI_DEFAULT_SHARE_SCOPE / _PAIR_BLEND / _SURVIVAL_CURVE`                      | akari-score.ts                       | game / 0.25 / inverse                                                                                     | 口径默认         |
| `AKARI_TAG_THRESHOLDS`                                                           | akari-score.ts                       | effort 10 / carry 11 (+1.25 内部) / lying 6 / blame 5 / stomp 1.25·2.0·25min·1.12 / blameTeammatesMin 4.5 | 标签             |
| `AKARI_POSITION_WEIGHTS` / `AKARI_ARAM_WEIGHTS` / `AKARI_MAYHEM_WEIGHTS`         | akari-score.ts                       | 见文件                                                                                                    | 权重表           |
| `AKARI_POSITION_BASELINES`                                                       | akari-score.ts                       | 见文件                                                                                                    | 位置基线         |
| `RATING_CALIBRATION_GAMES / _MIN_GAMES`                                          | use-rating-calibration.ts            | 400 / 20                                                                                                  | 校准样本         |
| 校准 `shrinkage / l2 / iterations`                                               | akari-score-calibration.ts           | 300 / 1 / 400                                                                                             | 拟合             |
| `MIN_UNANCHORED_MATCHUP_GAMES`                                                   | matchup-build.ts                     | 5                                                                                                         | 冷门对位最小样本 |
| `GAME_REFOCUS_LEAD_SECONDS / POLL_ALIVE_MS / POLL_DEAD_MS / MIN_ACTIVATE_GAP_MS` | game-refocus/context.ts              | 2 / 1000 / 500 / 5000                                                                                     | 复活切回         |
| 赛后弹窗尺寸 / 自动收起                                                          | post-game-window/window.ts, state.ts | 440×780 / 120s                                                                                            | 弹窗             |
| `TARGET_GAMES / DEEP_GAMES / EARLY_MS / ROAM_START_MS`                           | midlane-research.ts                  | 500 / 60 / 14min / 90s                                                                                    | 中单研究         |
| `MIDLANE_CACHE_TTL`                                                              | PlayerInfoCardMidlaneResearch.vue    | 30 分钟                                                                                                   | 缓存             |
| `BZ_SHEET_ID` / gid                                                              | bz-guide.ts                          | 1FInDZ2… / 1026317672                                                                                     | Bz 源            |
| 默认地区/段位                                                                    | champion-data/state.ts               | kr / emerald_plus                                                                                         | OP.GG 窗口       |

复盘台常量补充（均在 `src/renderer-shared/components/review-studio/`）：

| 项                    | 位置                  | 当前值                         |
| --------------------- | --------------------- | ------------------------------ |
| 快照容差 / 断帧阈值   | analysis.ts           | ±10 秒 / 75 秒                 |
| 经济收缩门槛 / 时间窗 | analysis.ts           | 个人 750、团队 2000 / 2–5 分钟 |
| 死亡后敌方目标关联窗  | analysis.ts           | 90 秒，仅时间关联              |
| 领先兑现门槛          | statistics.ts         | 个人 500、团队 1500 金         |
| 请求并发 / 历史上限   | data-loader.ts        | 每渲染进程 3 / 500 摘要        |
| 单批分析数量          | ReviewStudioModal.vue | 20 / 40 / 60                   |
| 成功缓存              | data-loader.ts        | 120 局 / 15 分钟               |
| 精简档案容量          | archive.ts            | 每账号/目标作用域最近 200 局   |
| 笔记长度              | notes.ts              | 4000 字符                      |
