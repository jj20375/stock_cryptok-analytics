# 玄學羅盤（紫微變盤時機＋八字個人運勢）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or execute inline task-by-task with review checkpoints. Steps use checkbox (`- [ ]`) syntax for tracking.

> **規劃時已驗證：** Task 1–9 的程式碼與 35 個測試已在隔離的專案鏡像（使用本專案 node_modules）中實際執行全部通過，`tsc` 型別檢查無錯誤，回測腳本已對真實公開行情跑過一次。實作時仍須依步驟先看到測試失敗再實作。

**Goal:** 新增獨立的 `/metaphysics`「玄學羅盤」：以紫微市場本命盤推算台股／BTC／美股變盤日，以登入者八字分析命局與運勢，並以歷史行情回測命中率、對照基準機率。

**Architecture:** 排盤與評分全部是 `app/services/metaphysics/` 下的純函式。三個市場本命盤用 iztro（devDependency）預先產生成常數檔，Worker 執行期只用 lunar-typescript 算干支並查四化表。D1 新增三張表（加密生辰、每日預測快照、AI 解說快取）。頁面 loader 計算 31 天日曆、寫入當日快照、回填實際漲跌；AI 解說由獨立 API 非同步載入。

**Tech Stack:** React Router 7（Cloudflare Workers）、Drizzle ORM + D1、`lunar-typescript`（執行期）、`iztro`（僅產生器與測試）、`node:test` + `tsx`、Miniflare（D1 整合測試）。

**設計文件：** `docs/superpowers/specs/2026-11-09-metaphysics-compass-design.md`（實作前先讀完，尤其第 5、6、10 節的規則）。

## Global Constraints

- 單一手寫檔案不得超過 1000 行；單一 React component 不超過 250 行；單一函式超過 80 行要拆 helper（`docs/ai-development-rules.md`）。
- 程式註解、重要變數說明一律繁體中文；寫明「為什麼」、門檻意義、時區、副作用與失敗風險。
- 玄學結果**不得**寫入台股漲跌羅盤分數、策略選股、自動下單、風控或任何既有排程；**不推播**（不新增 cron、不發 Slack／Telegram）。
- 輸出只到運勢層級描述，**不得**出現個股代號或買賣指令。
- 每個頁面與首頁小卡固定顯示「玄學參考・非量化訊號」與「不構成投資建議」。
- 規則版本常數：`ZIWEI_RULE_VERSION = 'ziwei-v1'`、`BAZI_RULE_VERSION = 'bazi-v1'`；任何權重或門檻變更都必須升版。
- 生辰一律用 `encryptData`／`decryptData`（`app/utils/encryption.ts`）配 `env.MASTER_ENCRYPTION_KEY` 加密保存，性別也在加密內容內。
- 送給 AI 的內容只能是衍生標籤（身強弱、喜用分組、性格標籤、吉凶等級、觸發規則），**不得**包含出生年月日時或四柱干支。
- 回測資料只走 `fetchStockDailyHistory`（Yahoo）與 `fetchBinanceRange`；**不得**使用 `stockService.fetchStockData()`。
- 測試指令格式：`node --import tsx --test tests/<file>.test.ts`。
- 完成前必須 `npm run build` 通過。
- 目前 master 上有大量與本功能無關的未提交修改。**每次 commit 只 `git add` 本任務列出的檔案**，不得 `git add -A` 或 `git add .`。

## 檔案結構

| 路徑 | 職責 |
|---|---|
| `app/services/metaphysics/ganzhi.ts` | 天干地支、五行、十神、藏干、六沖對照表與純函式 |
| `app/services/metaphysics/calendarTime.ts` | 時區日期、日期加減、台灣舊時制修正 |
| `app/services/metaphysics/marketChartSpecs.ts` | 三個市場的出生時刻、時區、行情代號 |
| `app/services/metaphysics/natalChartBuilder.ts` | iztro 星盤 → 精簡本命盤（只供產生器與測試） |
| `app/services/metaphysics/marketNatalCharts.generated.ts` | 產生器輸出的本命盤常數 |
| `app/services/metaphysics/types.ts` | 共用型別、規則版本 |
| `app/services/metaphysics/ziweiTiming.ts` | 紫微變盤規則 ziwei-v1 |
| `app/services/metaphysics/baziProfile.ts` | 八字命局、強弱、喜用、性格標籤、大運 |
| `app/services/metaphysics/baziLuck.ts` | 大運／流年／流月／流日吉凶 |
| `app/services/metaphysics/combinedHint.ts` | 市場變盤＋個人流日的疊加提示 |
| `app/services/metaphysics/hitRate.ts` | 實際變盤判定、命中率、Wilson 區間 |
| `app/db/metaphysicsSchema.ts`、`drizzle/0031_metaphysics.sql` | 三張新表 |
| `app/services/metaphysics/birthInput.ts` | 生辰表單驗證（純函式） |
| `app/services/metaphysics/birthProfileStore.server.ts` | 生辰加密存取 |
| `app/services/metaphysics/forecastStore.server.ts` | 每日快照寫入、回填、讀取 |
| `app/services/metaphysics/marketBars.server.ts` | 抓日線並換成當地日期收盤 |
| `app/services/metaphysics/narrative.server.ts` | AI 解說、快取、模板 fallback |
| `app/services/metaphysics/pageData.server.ts` | 頁面 loader／action 與今日摘要 |
| `scripts/metaphysics/generate-market-charts.ts` | 產生本命盤常數 |
| `scripts/metaphysics/backtest-ziwei-timing.ts` | 回測並輸出報告與 SQL |
| `app/routes/metaphysics.tsx`、`app/routes/api.metaphysics.ts` | 頁面與 API |
| `app/features/metaphysics/*.tsx` | 頁面元件 |
| `app/features/home/components/MetaphysicsMiniCard.tsx` | 首頁小卡 |
| `docs/metaphysics-compass.md` | 功能說明與部署步驟 |

---

### Task 0: 建立分支

- [ ] **Step 1: 建立功能分支**

目前在 master，工作區有大量未提交的無關修改；切分支時這些修改會跟著過去但不會被 commit。

```bash
git switch -c feat/metaphysics-compass
```

---

### Task 1: 安裝套件與命理基礎表

**Files:**
- Modify: `package.json`（新增依賴）
- Create: `app/services/metaphysics/ganzhi.ts`
- Create: `app/services/metaphysics/calendarTime.ts`
- Test: `tests/metaphysics-foundation.test.ts`

**Interfaces:**
- Produces:
  - `ganzhi.ts`：`STEMS`、`BRANCHES`、`type Stem`、`type Branch`、`type Element`、`type TenGod`、`type TenGodGroup`、`HIDDEN_STEMS: Record<Branch, Stem[]>`、`stemElement(stem): Element`、`branchElement(branch): Element`、`isYangStem(stem): boolean`、`generates(from, to): boolean`、`controls(from, to): boolean`、`tenGodOf(dayStem, other): TenGod`、`tenGodGroup(god): TenGodGroup`、`elementGroup(dayElement, element): TenGodGroup`、`branchesClash(a, b): boolean`
  - `calendarTime.ts`：`DAY_MS`、`interface WallTime { year; month; day; hour; minute }`、`TAIPEI_PLUS9_RANGES`、`toTaipeiStandardTime(wall): { wall: WallTime; corrected: boolean }`、`localDateOf(utcMs, timeZone): string`、`addDays(isoDate, days): string`、`parseIsoDate(isoDate): { year; month; day }`

- [ ] **Step 1: 安裝套件**

```bash
npm install lunar-typescript@1.8.7
npm install -D iztro@2.6.5
```

預期：`package.json` 的 `dependencies` 出現 `lunar-typescript`，`devDependencies` 出現 `iztro`。iztro 只給產生器和測試用，Worker 不載入。

- [ ] **Step 2: 寫失敗的測試**

`tests/metaphysics-foundation.test.ts`：

```ts
/** @file 命理基礎表與時間換算：十神、六沖、台灣舊時制修正、時區日期。純函式測試，不連網路與資料庫。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { branchesClash, elementGroup, tenGodGroup, tenGodOf } from '../app/services/metaphysics/ganzhi';
import { addDays, localDateOf, toTaipeiStandardTime } from '../app/services/metaphysics/calendarTime';

test('十神：以丙火日主為例，五類十神陰陽正偏都正確', () => {
  assert.equal(tenGodOf('丙', '丙'), '比肩');
  assert.equal(tenGodOf('丙', '丁'), '劫財');
  assert.equal(tenGodOf('丙', '戊'), '食神');
  assert.equal(tenGodOf('丙', '己'), '傷官');
  assert.equal(tenGodOf('丙', '庚'), '偏財');
  assert.equal(tenGodOf('丙', '辛'), '正財');
  assert.equal(tenGodOf('丙', '壬'), '七殺');
  assert.equal(tenGodOf('丙', '癸'), '正官');
  assert.equal(tenGodOf('丙', '甲'), '偏印');
  assert.equal(tenGodOf('丙', '乙'), '正印');
  assert.equal(tenGodGroup('傷官'), '食傷');
  assert.equal(elementGroup('火', '金'), '財');
  assert.equal(elementGroup('火', '木'), '印');
});

test('六沖：子午、巳亥相沖，子丑不沖', () => {
  assert.equal(branchesClash('子', '午'), true);
  assert.equal(branchesClash('亥', '巳'), true);
  assert.equal(branchesClash('子', '丑'), false);
});

test('台灣舊時制：1975 夏季減 1 小時並可跨日，冬季與 1976 不修正，日治 UTC+9 也修正', () => {
  assert.deepEqual(toTaipeiStandardTime({ year: 1975, month: 6, day: 15, hour: 0, minute: 30 }),
    { wall: { year: 1975, month: 6, day: 14, hour: 23, minute: 30 }, corrected: true });
  assert.equal(toTaipeiStandardTime({ year: 1975, month: 12, day: 15, hour: 0, minute: 30 }).corrected, false);
  assert.equal(toTaipeiStandardTime({ year: 1976, month: 6, day: 15, hour: 9, minute: 30 }).corrected, false);
  assert.deepEqual(toTaipeiStandardTime({ year: 1940, month: 1, day: 1, hour: 12, minute: 0 }).wall,
    { year: 1940, month: 1, day: 1, hour: 11, minute: 0 });
});

test('時區日期：同一瞬間在台北與紐約是不同日期；日期加減跨月', () => {
  const instant = Date.UTC(2026, 10, 9, 1, 0); // 2026-11-09 01:00 UTC
  assert.equal(localDateOf(instant, 'Asia/Taipei'), '2026-11-09');
  assert.equal(localDateOf(instant, 'America/New_York'), '2026-11-08');
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});
```

- [ ] **Step 3: 確認測試失敗**

Run: `node --import tsx --test tests/metaphysics-foundation.test.ts`
Expected: FAIL，錯誤為找不到 `../app/services/metaphysics/ganzhi` 模組。

- [ ] **Step 4: 實作 `app/services/metaphysics/ganzhi.ts`**

```ts
/** @file 天干地支、五行、十神、藏干、六沖等命理基礎對照表；八字與紫微共用，純資料與純函式。 */

/** 十天干，依序；索引偶數為陽干、奇數為陰干。 */
export const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'] as const;
/** 十二地支，依序（子=0）。 */
export const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const;
export type Stem = typeof STEMS[number];
export type Branch = typeof BRANCHES[number];
export type Element = '木' | '火' | '土' | '金' | '水';
export type TenGod = '比肩' | '劫財' | '食神' | '傷官' | '偏財' | '正財' | '七殺' | '正官' | '偏印' | '正印';
/** 十神的五類分組，喜用神與吉凶判斷以分組為單位。 */
export type TenGodGroup = '比劫' | '食傷' | '財' | '官殺' | '印';

/** 天干五行：甲乙木、丙丁火、戊己土、庚辛金、壬癸水。 */
const STEM_ELEMENT: Record<Stem, Element> = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' };
/** 地支本氣五行。 */
const BRANCH_ELEMENT: Record<Branch, Element> = { 子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火', 午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水' };
/** 地支藏干，順序固定為 [本氣, 中氣, 餘氣]；與 lunar-typescript 的 getXHideGan 一致，自行維護以利測試。 */
export const HIDDEN_STEMS: Record<Branch, Stem[]> = {
  子: ['癸'], 丑: ['己', '癸', '辛'], 寅: ['甲', '丙', '戊'], 卯: ['乙'], 辰: ['戊', '乙', '癸'], 巳: ['丙', '庚', '戊'],
  午: ['丁', '己'], 未: ['己', '丁', '乙'], 申: ['庚', '壬', '戊'], 酉: ['辛'], 戌: ['戊', '辛', '丁'], 亥: ['壬', '甲'],
};
/** 五行相生：木生火、火生土、土生金、金生水、水生木。 */
const GENERATES: Record<Element, Element> = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
/** 五行相剋：木剋土、土剋水、水剋火、火剋金、金剋木。 */
const CONTROLS: Record<Element, Element> = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };

export const stemElement = (stem: Stem): Element => STEM_ELEMENT[stem];
export const branchElement = (branch: Branch): Element => BRANCH_ELEMENT[branch];
export const isYangStem = (stem: Stem): boolean => STEMS.indexOf(stem) % 2 === 0;
export const generates = (from: Element, to: Element): boolean => GENERATES[from] === to;
export const controls = (from: Element, to: Element): boolean => CONTROLS[from] === to;

/** 以日主為基準，回傳另一個天干的十神；陰陽相同為偏（比肩、食神、偏財、七殺、偏印），不同為正。 */
export function tenGodOf(dayStem: Stem, other: Stem): TenGod {
  const me = stemElement(dayStem), it = stemElement(other);
  const same = isYangStem(dayStem) === isYangStem(other);
  if (me === it) return same ? '比肩' : '劫財';
  if (generates(me, it)) return same ? '食神' : '傷官';
  if (controls(me, it)) return same ? '偏財' : '正財';
  if (controls(it, me)) return same ? '七殺' : '正官';
  return same ? '偏印' : '正印';
}

/** 十神 → 五類分組。 */
export function tenGodGroup(god: TenGod): TenGodGroup {
  if (god === '比肩' || god === '劫財') return '比劫';
  if (god === '食神' || god === '傷官') return '食傷';
  if (god === '偏財' || god === '正財') return '財';
  if (god === '七殺' || god === '正官') return '官殺';
  return '印';
}

/** 以日主五行為基準，回傳某五行屬於哪一類（同我比劫、我生食傷、我剋財、剋我官殺、生我印）。 */
export function elementGroup(dayElement: Element, element: Element): TenGodGroup {
  if (element === dayElement) return '比劫';
  if (generates(dayElement, element)) return '食傷';
  if (controls(dayElement, element)) return '財';
  if (controls(element, dayElement)) return '官殺';
  return '印';
}

/** 地支六沖：相距 6 位即相沖（子午、丑未、寅申、卯酉、辰戌、巳亥）。 */
export const branchesClash = (a: Branch, b: Branch): boolean =>
  Math.abs(BRANCHES.indexOf(a) - BRANCHES.indexOf(b)) === 6;
```

- [ ] **Step 5: 實作 `app/services/metaphysics/calendarTime.ts`**

```ts
/** @file 玄學模組的時間換算：時區日期、日期加減、台灣舊時制修正。全部不依賴執行環境的系統時區。 */

/** 一天的毫秒數。 */
export const DAY_MS = 86_400_000;

/** 年月日時分（牆上時鐘時間，不含時區）。 */
export interface WallTime { year: number; month: number; day: number; hour: number; minute: number }

/**
 * 台灣時鐘比標準時間（UTC+8）快 1 小時的區間，以 UTC 表示 [start, end)。
 * 資料來源：IANA tzdata `Asia/Taipei`（2026-11-09 以 Node Intl 逐小時掃描 1900–1985 取得）。
 * 1937-10-01～1945-09-20 是日治時期改用 UTC+9，其餘是日光節約時間；排盤一律換回 UTC+8 標準時間。
 */
export const TAIPEI_PLUS9_RANGES: ReadonlyArray<readonly [string, string]> = [
  ['1937-09-30T16:00:00Z', '1945-09-20T16:00:00Z'],
  ['1946-05-14T16:00:00Z', '1946-09-30T15:00:00Z'],
  ['1947-04-14T16:00:00Z', '1947-10-31T15:00:00Z'],
  ['1948-04-30T16:00:00Z', '1948-09-30T15:00:00Z'],
  ['1949-04-30T16:00:00Z', '1949-09-30T15:00:00Z'],
  ['1950-04-30T16:00:00Z', '1950-09-30T15:00:00Z'],
  ['1951-04-30T16:00:00Z', '1951-09-30T15:00:00Z'],
  ['1952-02-29T16:00:00Z', '1952-10-31T15:00:00Z'],
  ['1953-03-31T16:00:00Z', '1953-10-31T15:00:00Z'],
  ['1954-03-31T16:00:00Z', '1954-10-31T15:00:00Z'],
  ['1955-03-31T16:00:00Z', '1955-09-30T15:00:00Z'],
  ['1956-03-31T16:00:00Z', '1956-09-30T15:00:00Z'],
  ['1957-03-31T16:00:00Z', '1957-09-30T15:00:00Z'],
  ['1958-03-31T16:00:00Z', '1958-09-30T15:00:00Z'],
  ['1959-03-31T16:00:00Z', '1959-09-30T15:00:00Z'],
  ['1960-05-31T16:00:00Z', '1960-09-30T15:00:00Z'],
  ['1961-05-31T16:00:00Z', '1961-09-30T15:00:00Z'],
  ['1974-03-31T16:00:00Z', '1974-09-30T15:00:00Z'],
  ['1975-03-31T16:00:00Z', '1975-09-30T15:00:00Z'],
  ['1979-06-30T16:00:00Z', '1979-09-30T15:00:00Z'],
];
const PLUS9_MS = TAIPEI_PLUS9_RANGES.map(([s, e]) => [Date.parse(s), Date.parse(e)] as const);

/**
 * 把台灣出生的牆上時間換成 UTC+8 標準時間。
 * 做法：假設牆上時間是 +9 換成 UTC 瞬間，若該瞬間落在 +9 區間內就減 1 小時。
 * 區間交界的那一小時本身有歧義，命理實務上也無法分辨，這裡以「落在區間內」為準。
 */
export function toTaipeiStandardTime(wall: WallTime): { wall: WallTime; corrected: boolean } {
  const assumedPlus9Utc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour - 9, wall.minute);
  const corrected = PLUS9_MS.some(([start, end]) => assumedPlus9Utc >= start && assumedPlus9Utc < end);
  if (!corrected) return { wall, corrected: false };
  const shifted = new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour - 1, wall.minute));
  return {
    wall: { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes() },
    corrected: true,
  };
}

/** 回傳某個 UTC 瞬間在指定 IANA 時區的當地日期 YYYY-MM-DD（en-CA 格式即 ISO 日期）。 */
export function localDateOf(utcMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(utcMs));
}

/** 'YYYY-MM-DD' 加減天數（以 UTC 計算日曆日，不受時區影響）。 */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → 年月日數字。 */
export function parseIsoDate(isoDate: string): { year: number; month: number; day: number } {
  const [year, month, day] = isoDate.split('-').map(Number);
  return { year, month, day };
}
```

- [ ] **Step 6: 確認測試通過**

Run: `node --import tsx --test tests/metaphysics-foundation.test.ts`
Expected: 4 個 test 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json app/services/metaphysics/ganzhi.ts app/services/metaphysics/calendarTime.ts tests/metaphysics-foundation.test.ts
git commit -m "feat: 玄學羅盤命理基礎表與時間換算"
```

---

### Task 2: 市場本命盤設定與產生器

**Files:**
- Create: `app/services/metaphysics/types.ts`
- Create: `app/services/metaphysics/marketChartSpecs.ts`
- Create: `app/services/metaphysics/natalChartBuilder.ts`
- Create: `scripts/metaphysics/generate-market-charts.ts`
- Create（產生）: `app/services/metaphysics/marketNatalCharts.generated.ts`
- Test: `tests/metaphysics-market-charts.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  - `types.ts`：`ZIWEI_RULE_VERSION`、`BAZI_RULE_VERSION`、`type Mutagen = '祿'|'權'|'科'|'忌'`、`type LuckLayer = '流年'|'流月'|'流日'`、`interface NatalPalace { index; name; earthlyBranch; stars: string[]; decadalRange: [number, number] }`、`interface NatalChart { chineseDate; fiveElementsClass; palaces: NatalPalace[] }`、`interface MutagenPlacement { layer; mutagen; star; palaceIndex; palaceName }`、`interface ZiweiDayResult { market; tradeDate; stems: Record<LuckLayer, Stem>; placements; directionScore; turningPoints; turningStrength: 0|1|2|3; triggers: string[]; ruleVersion }`
  - `marketChartSpecs.ts`：`type MetaMarket = 'TW'|'CRYPTO'|'US'`、`interface MarketChartSpec`、`MARKET_CHART_GENDER`、`MARKET_CHART_SPECS: Record<MetaMarket, MarketChartSpec>`、`MARKET_BIRTH_YEAR: Record<MetaMarket, number>`
  - `natalChartBuilder.ts`：`buildNatalPalaces(astrolabe): NatalPalace[]`
  - `marketNatalCharts.generated.ts`：`MARKET_NATAL_CHARTS: Record<MetaMarket, NatalChart>`

- [ ] **Step 1: 建立 `app/services/metaphysics/types.ts`**

```ts
/** @file 玄學羅盤共用型別與規則版本。規則版本一改，回測與快照都要分開統計。 */
import type { Stem } from './ganzhi';
import type { MetaMarket } from './marketChartSpecs';

/** 紫微變盤規則版本；任何權重或門檻調整都必須升版。 */
export const ZIWEI_RULE_VERSION = 'ziwei-v1';
/** 八字評分規則版本。 */
export const BAZI_RULE_VERSION = 'bazi-v1';

/** 四化種類，順序與 iztro mutagen 陣列一致：[祿, 權, 科, 忌]。 */
export type Mutagen = '祿' | '權' | '科' | '忌';
/** 運限層級。 */
export type LuckLayer = '流年' | '流月' | '流日';

/** 本命盤的單一宮位（精簡版）。 */
export interface NatalPalace {
  /** iztro 宮位索引 0–11（0 為寅宮）。對宮 = (index + 6) % 12。 */
  index: number;
  /** 宮名，例如「命宮」「財帛」。 */
  name: string;
  earthlyBranch: string;
  /** 主星＋輔星名稱（繁體）；四化只會落在這些星上。 */
  stars: string[];
  /** 大限虛歲區間 [起, 迄]。 */
  decadalRange: [number, number];
}

export interface NatalChart {
  chineseDate: string;
  fiveElementsClass: string;
  palaces: NatalPalace[];
}

/** 某層運限的一個四化落宮事件。 */
export interface MutagenPlacement {
  layer: LuckLayer;
  mutagen: Mutagen;
  star: string;
  palaceIndex: number;
  palaceName: string;
}

/** 某市場某一天的紫微判讀結果。 */
export interface ZiweiDayResult {
  market: MetaMarket;
  /** 市場當地日期 YYYY-MM-DD。 */
  tradeDate: string;
  stems: Record<LuckLayer, Stem>;
  placements: MutagenPlacement[];
  /** 方向分數 -100～+100，正值偏多。 */
  directionScore: number;
  /** 變盤點數（未分級前）。 */
  turningPoints: number;
  /** 變盤強度 0–3。 */
  turningStrength: 0 | 1 | 2 | 3;
  /** 觸發的規則說明，供頁面展開與 AI 解說使用。 */
  triggers: string[];
  ruleVersion: string;
}
```

- [ ] **Step 2: 建立 `app/services/metaphysics/marketChartSpecs.ts`**

```ts
/** @file 三個市場的紫微「本命盤」出生時刻設定；產生器與執行期共用。修改後必須重跑產生器並升版 ZIWEI_RULE_VERSION。 */

/** 市場代碼，與 klineStore 的 MarketType 相同字串。 */
export type MetaMarket = 'TW' | 'CRYPTO' | 'US';

export interface MarketChartSpec {
  market: MetaMarket;
  /** 顯示名稱。 */
  label: string;
  /** 本命盤國曆日期（當地時間）YYYY-M-D，iztro 的輸入格式。 */
  solarDate: string;
  /** iztro 時辰序號：5 巳時（09–11）、6 午時（11–13）、9 酉時（17–19）。 */
  timeIndex: number;
  /** 出生時刻文字說明（含依據），頁面顯示用。 */
  birthNote: string;
  /** 時辰是否為假設（史料無記載）；true 時頁面必須註明。 */
  timeAssumed: boolean;
  /** 流日換日所依據的 IANA 時區，與該市場日 K 收盤切法一致。 */
  timeZone: string;
  /** 回測與回填使用的行情代號：股市為 Yahoo 指數代號，加密貨幣為交易對。 */
  quoteSymbol: string;
}

/**
 * 市場盤性別一律以「男」排盤：紫微的大限順逆需要性別，市場沒有性別，這是本系統的約定。
 * 評分只用流年、流月、流日，大限只作背景顯示，因此性別約定不影響分數。
 */
export const MARKET_CHART_GENDER = '男' as const;

export const MARKET_CHART_SPECS: Record<MetaMarket, MarketChartSpec> = {
  TW: { market: 'TW', label: '台股', solarDate: '1962-2-9', timeIndex: 5, timeAssumed: false,
    birthNote: '臺灣證券交易所開業 1962-02-09 09:00（台北）', timeZone: 'Asia/Taipei', quoteSymbol: '^TWII' },
  CRYPTO: { market: 'CRYPTO', label: 'BTC', solarDate: '2009-1-3', timeIndex: 9, timeAssumed: false,
    birthNote: '比特幣創世區塊 2009-01-03 18:15 UTC', timeZone: 'UTC', quoteSymbol: 'BTCUSDT' },
  US: { market: 'US', label: '美股', solarDate: '1792-5-17', timeIndex: 6, timeAssumed: true,
    birthNote: 'NYSE 梧桐樹協議 1792-05-17，史料無時辰，假設為午時', timeZone: 'America/New_York', quoteSymbol: '^GSPC' },
};

/** 各市場出生年（國曆），計算大限虛歲用。 */
export const MARKET_BIRTH_YEAR: Record<MetaMarket, number> = { TW: 1962, CRYPTO: 2009, US: 1792 };
```

- [ ] **Step 3: 建立 `app/services/metaphysics/natalChartBuilder.ts`**

```ts
/** @file 把 iztro 星盤轉成本系統的精簡本命盤；只在產生器與測試中使用，Worker 執行期不載入 iztro。 */
import type { NatalPalace } from './types';

/** iztro FunctionalAstrolabe 中本模組用到的欄位（避免在型別上直接依賴 iztro）。 */
interface AstrolabeLike {
  palaces: Array<{ index: number; name: string; earthlyBranch: string; majorStars: Array<{ name: string }>;
    minorStars: Array<{ name: string }>; decadal: { range: number[] } }>;
}

/** 只保留主星與輔星（四化只會落在這些星上），以及大限虛歲區間。 */
export function buildNatalPalaces(astrolabe: AstrolabeLike): NatalPalace[] {
  return astrolabe.palaces.map((palace) => ({
    index: palace.index,
    name: palace.name,
    earthlyBranch: palace.earthlyBranch,
    stars: [...palace.majorStars, ...palace.minorStars].map((star) => star.name),
    decadalRange: [palace.decadal.range[0], palace.decadal.range[1]] as [number, number],
  }));
}
```

- [ ] **Step 4: 建立產生器 `scripts/metaphysics/generate-market-charts.ts`**

```ts
/**
 * @file 產生三個市場的紫微本命盤常數檔 `app/services/metaphysics/marketNatalCharts.generated.ts`。
 * 為什麼預先產生：iztro 單次排運限約 5ms，頁面一次要算 3 市場 × 31 天，Worker CPU 吃不消；
 * 本命盤固定不變，預先算好星曜落宮，執行期只需查表＋lunar 算干支（每天約 0.01ms）。
 * 執行：node --import tsx scripts/metaphysics/generate-market-charts.ts
 */
import { writeFileSync } from 'node:fs';
import { astro } from 'iztro';
import { MARKET_CHART_GENDER, MARKET_CHART_SPECS } from '../../app/services/metaphysics/marketChartSpecs';
import { buildNatalPalaces } from '../../app/services/metaphysics/natalChartBuilder';

const OUTPUT_PATH = 'app/services/metaphysics/marketNatalCharts.generated.ts';

const charts = Object.fromEntries(Object.values(MARKET_CHART_SPECS).map((spec) => {
  // fixLeap=true：閏月前半算上個月、後半算下個月，與 iztro 預設一致。
  const astrolabe = astro.bySolar(spec.solarDate, spec.timeIndex, MARKET_CHART_GENDER, true, 'zh-TW');
  return [spec.market, { chineseDate: astrolabe.chineseDate, fiveElementsClass: astrolabe.fiveElementsClass,
    palaces: buildNatalPalaces(astrolabe) }];
}));

const body = `/** @file 由 scripts/metaphysics/generate-market-charts.ts 自動產生，請勿手動修改。 */
import type { NatalChart } from './types';
import type { MetaMarket } from './marketChartSpecs';

export const MARKET_NATAL_CHARTS: Record<MetaMarket, NatalChart> = ${JSON.stringify(charts, null, 2)};
`;
writeFileSync(OUTPUT_PATH, body);
console.log(`已產生 ${OUTPUT_PATH}`);
```

- [ ] **Step 5: 寫失敗的測試**

`tests/metaphysics-market-charts.test.ts`：

```ts
/** @file 市場本命盤常數必須與 iztro 即時排盤一致；改了出生時刻卻忘了重跑產生器時，這裡會失敗。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { astro } from 'iztro';
import { MARKET_CHART_GENDER, MARKET_CHART_SPECS } from '../app/services/metaphysics/marketChartSpecs';
import { buildNatalPalaces } from '../app/services/metaphysics/natalChartBuilder';
import { MARKET_NATAL_CHARTS } from '../app/services/metaphysics/marketNatalCharts.generated';

test('三個市場的常數本命盤與 iztro 即時排盤完全一致', () => {
  for (const spec of Object.values(MARKET_CHART_SPECS)) {
    const astrolabe = astro.bySolar(spec.solarDate, spec.timeIndex, MARKET_CHART_GENDER, true, 'zh-TW');
    assert.deepEqual(MARKET_NATAL_CHARTS[spec.market].palaces, buildNatalPalaces(astrolabe), spec.market);
  }
});

test('台股本命盤：命宮在酉、有天同；財帛在巳、有巨門；大限 65–74 在遷移', () => {
  const tw = MARKET_NATAL_CHARTS.TW;
  const ming = tw.palaces.find((p) => p.name === '命宮')!;
  const wealth = tw.palaces.find((p) => p.name === '財帛')!;
  assert.equal(ming.earthlyBranch, '酉');
  assert.ok(ming.stars.includes('天同'));
  assert.equal(wealth.earthlyBranch, '巳');
  assert.ok(wealth.stars.includes('巨門'));
  assert.deepEqual(tw.palaces.find((p) => p.name === '遷移')!.decadalRange, [65, 74]);
  assert.equal(tw.chineseDate, '壬寅 壬寅 戊寅 丁巳');
});

test('BTC 本命盤命宮在辰；美股本命盤命宮在亥', () => {
  assert.equal(MARKET_NATAL_CHARTS.CRYPTO.palaces.find((p) => p.name === '命宮')!.earthlyBranch, '辰');
  assert.equal(MARKET_NATAL_CHARTS.US.palaces.find((p) => p.name === '命宮')!.earthlyBranch, '亥');
});
```

- [ ] **Step 6: 確認測試失敗**

Run: `node --import tsx --test tests/metaphysics-market-charts.test.ts`
Expected: FAIL，錯誤為找不到 `marketNatalCharts.generated`。

- [ ] **Step 7: 執行產生器**

Run: `node --import tsx scripts/metaphysics/generate-market-charts.ts`
Expected: 印出 `已產生 app/services/metaphysics/marketNatalCharts.generated.ts`，檔案內有 TW、CRYPTO、US 三組各 12 宮。

- [ ] **Step 8: 確認測試通過**

Run: `node --import tsx --test tests/metaphysics-market-charts.test.ts`
Expected: 3 個 test 全部 PASS。

- [ ] **Step 9: Commit**

```bash
git add app/services/metaphysics/types.ts app/services/metaphysics/marketChartSpecs.ts app/services/metaphysics/natalChartBuilder.ts app/services/metaphysics/marketNatalCharts.generated.ts scripts/metaphysics/generate-market-charts.ts tests/metaphysics-market-charts.test.ts
git commit -m "feat: 玄學羅盤三市場紫微本命盤與產生器"
```

### Task 3: 紫微變盤規則 ziwei-v1

**Files:**
- Create: `app/services/metaphysics/ziweiTiming.ts`
- Test: `tests/metaphysics-ziwei.test.ts`

**Interfaces:**
- Consumes: `STEMS`、`type Stem`（ganzhi）；`parseIsoDate`（calendarTime）；`MARKET_NATAL_CHARTS`；`type MetaMarket`；`ZIWEI_RULE_VERSION`、`LuckLayer`、`Mutagen`、`MutagenPlacement`、`NatalChart`、`ZiweiDayResult`（types）
- Produces: `MUTAGEN_TABLE: Record<Stem, [string, string, string, string]>`、`luckStemsOf(isoDate): Record<LuckLayer, Stem>`、`placeMutagens(chart, stems): MutagenPlacement[]`、`scoreDirection(chart, placements, triggers): number`、`scoreTurningPoints(chart, placements, triggers): number`、`strengthFromPoints(points): 0|1|2|3`、`evaluateZiweiDay(market, tradeDate, chart?): ZiweiDayResult`、`currentDecadalPalace(chart, birthYear, currentYear): NatalPalace | null`

規則細節見設計文件第 5 節（含 2026-11-09 依觸發頻率的修正）。流月天干以「農曆月＋五虎遁、閏月 16 日起算下個月」計算，這是規劃時逐日比對 iztro 12 年得出的規則，測試會對 2020–2023 逐日比對（約 8 秒）。

- [ ] **Step 1: 寫失敗的測試**

`tests/metaphysics-ziwei.test.ts`：

```ts
/** @file 紫微變盤規則 ziwei-v1：干支與四化需與 iztro 逐日一致，並驗證已知日期的分數、強度與觸發規則。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { astro } from 'iztro';
import { addDays } from '../app/services/metaphysics/calendarTime';
import { MARKET_NATAL_CHARTS } from '../app/services/metaphysics/marketNatalCharts.generated';
import { currentDecadalPalace, evaluateZiweiDay, luckStemsOf, MUTAGEN_TABLE, strengthFromPoints } from '../app/services/metaphysics/ziweiTiming';

test('2020–2023 逐日（含 2020 閏四月、2023 閏二月）流年／流月／流日天干與四化和 iztro 一致', () => {
  const astrolabe = astro.bySolar('1962-2-9', 5, '男', true, 'zh-TW');
  for (let date = '2020-01-01'; date <= '2023-12-31'; date = addDays(date, 1)) {
    const horoscope = astrolabe.horoscope(date, 0);
    const stems = luckStemsOf(date);
    assert.equal(stems.流年, horoscope.yearly.heavenlyStem, `${date} 流年`);
    assert.equal(stems.流月, horoscope.monthly.heavenlyStem, `${date} 流月`);
    assert.equal(stems.流日, horoscope.daily.heavenlyStem, `${date} 流日`);
    assert.deepEqual(MUTAGEN_TABLE[stems.流日], horoscope.daily.mutagen, `${date} 四化`);
  }
});

test('台股 2026-11-09：丙年己月丁日，方向 +9、變盤點數 3、強度 1', () => {
  const result = evaluateZiweiDay('TW', '2026-11-09');
  assert.deepEqual(result.stems, { 流年: '丙', 流月: '己', 流日: '丁' });
  assert.equal(result.directionScore, 9);
  assert.equal(result.turningPoints, 3);
  assert.equal(result.turningStrength, 1);
  assert.ok(result.triggers.includes('變盤：流日忌入財帛（+2）'));
  assert.ok(result.triggers.includes('變盤：流日權入命宮（+1）'));
  assert.equal(result.ruleVersion, 'ziwei-v1');
});

test('台股 2026-11-12：流日天同忌入命宮並與流月文曲忌同宮，強度 3', () => {
  const result = evaluateZiweiDay('TW', '2026-11-12');
  assert.equal(result.directionScore, -1);
  assert.equal(result.turningPoints, 5);
  assert.equal(result.turningStrength, 3);
  assert.ok(result.triggers.includes('變盤：流日忌與流年／流月忌疊併（+2）'));
  assert.ok(result.triggers.includes('變盤：祿忌同宮於命宮（+1）'));
});

test('BTC 2026-11-09：流日巨門忌沖官祿計 -15×1.0，方向 +23、強度 0', () => {
  const result = evaluateZiweiDay('CRYPTO', '2026-11-09');
  assert.equal(result.directionScore, 23);
  assert.equal(result.turningStrength, 0);
  assert.ok(result.triggers.includes('流日巨門化忌沖官祿'));
});

test('變盤點數分級：0–2 → 0、3 → 1、4 → 2、≥5 → 3', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(strengthFromPoints), [0, 0, 0, 1, 2, 3, 3]);
});

test('大限：台股 2026 年虛歲 65 在遷移；美股超過 120 歲回傳 null', () => {
  assert.equal(currentDecadalPalace(MARKET_NATAL_CHARTS.TW, 1962, 2026)?.name, '遷移');
  assert.equal(currentDecadalPalace(MARKET_NATAL_CHARTS.US, 1792, 2026), null);
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `node --import tsx --test tests/metaphysics-ziwei.test.ts`
Expected: FAIL，錯誤為找不到 `ziweiTiming` 模組。

- [ ] **Step 3: 實作 `app/services/metaphysics/ziweiTiming.ts`**

```ts
/**
 * @file 紫微市場變盤時機（規則 ziwei-v1）。純函式：輸入市場與日期，輸出方向分數與變盤強度。
 * 玄學參考，非量化訊號；結果不得寫入羅盤分數、選股、下單或風控。
 */
import { Solar } from 'lunar-typescript';
import { STEMS, type Stem } from './ganzhi';
import { MARKET_NATAL_CHARTS } from './marketNatalCharts.generated';
import type { MetaMarket } from './marketChartSpecs';
import { parseIsoDate } from './calendarTime';
import { ZIWEI_RULE_VERSION, type LuckLayer, type Mutagen, type MutagenPlacement, type NatalChart, type ZiweiDayResult } from './types';

/** 天干四化表（iztro 預設派別），順序 [祿, 權, 科, 忌]；已用 iztro horoscope 做逐日比對測試。 */
export const MUTAGEN_TABLE: Record<Stem, [string, string, string, string]> = {
  甲: ['廉貞', '破軍', '武曲', '太陽'], 乙: ['天機', '天梁', '紫微', '太陰'], 丙: ['天同', '天機', '文昌', '廉貞'],
  丁: ['太陰', '天同', '天機', '巨門'], 戊: ['貪狼', '太陰', '右弼', '天機'], 己: ['武曲', '貪狼', '天梁', '文曲'],
  庚: ['太陽', '武曲', '太陰', '天同'], 辛: ['巨門', '太陽', '文曲', '文昌'], 壬: ['天梁', '紫微', '左輔', '武曲'],
  癸: ['破軍', '巨門', '太陰', '貪狼'],
};
const MUTAGENS: Mutagen[] = ['祿', '權', '科', '忌'];

/** 關鍵宮位：命宮（整體）、財帛（資金價格）、官祿（基本面）、田宅（資產庫存）、福德（情緒）、遷移（外部衝擊）。 */
const KEY_PALACES = new Set(['命宮', '財帛', '官祿', '田宅', '福德', '遷移']);
/** 層級權重：流日影響當天最直接，流月次之，流年只是背景。 */
const LAYER_WEIGHT: Record<LuckLayer, number> = { 流日: 1.0, 流月: 0.6, 流年: 0.3 };
/** 四化入關鍵宮位的基礎分；忌入對宮（沖）另計 -15。 */
const MUTAGEN_BASE: Record<Mutagen, number> = { 祿: 20, 權: 10, 科: 5, 忌: -20 };
const JI_CLASH_BASE = -15;

/**
 * 取得某國曆日的流年、流月、流日天干（與 iztro horoscope 規則一致）：
 * - 流年：農曆年干（正月初一換年）。
 * - 流月：五虎遁，以流年干與農曆月數推算；閏月 15 日以前算本月、16 日起算下個月（iztro fixLeap）。
 * - 流日：日干支的天干。
 */
export function luckStemsOf(isoDate: string): Record<LuckLayer, Stem> {
  const { year, month, day } = parseIsoDate(isoDate);
  const lunar = Solar.fromYmd(year, month, day).getLunar();
  const yearStem = lunar.getYearGan() as Stem;
  const rawMonth = lunar.getMonth();
  const lunarMonth = rawMonth < 0 && lunar.getDay() > 15 ? Math.abs(rawMonth) + 1 : Math.abs(rawMonth);
  const monthStemIndex = ((STEMS.indexOf(yearStem) % 5) * 2 + 2 + (lunarMonth - 1)) % 10;
  return { 流年: yearStem, 流月: STEMS[monthStemIndex], 流日: lunar.getDayGan() as Stem };
}

/** 找出四化星在本命盤中的落宮；找不到（理論上不會）就略過。 */
export function placeMutagens(chart: NatalChart, stems: Record<LuckLayer, Stem>): MutagenPlacement[] {
  const placements: MutagenPlacement[] = [];
  for (const layer of ['流年', '流月', '流日'] as LuckLayer[]) {
    MUTAGEN_TABLE[stems[layer]].forEach((star, i) => {
      const palace = chart.palaces.find((p) => p.stars.includes(star));
      if (palace) placements.push({ layer, mutagen: MUTAGENS[i], star, palaceIndex: palace.index, palaceName: palace.name });
    });
  }
  return placements;
}

const oppositeIndex = (index: number) => (index + 6) % 12;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 方向分數：四化入關鍵宮位加減分，忌星不在關鍵宮但沖關鍵宮時 -15；乘上層級權重後加總。 */
export function scoreDirection(chart: NatalChart, placements: MutagenPlacement[], triggers: string[]): number {
  let total = 0;
  for (const p of placements) {
    const weight = LAYER_WEIGHT[p.layer];
    if (KEY_PALACES.has(p.palaceName)) {
      total += MUTAGEN_BASE[p.mutagen] * weight;
      triggers.push(`${p.layer}${p.star}化${p.mutagen}入${p.palaceName}`);
    } else if (p.mutagen === '忌') {
      const opposite = chart.palaces[oppositeIndex(p.palaceIndex)];
      if (KEY_PALACES.has(opposite.name)) {
        total += JI_CLASH_BASE * weight;
        triggers.push(`${p.layer}${p.star}化忌沖${opposite.name}`);
      }
    }
  }
  return clamp(Math.round(total), -100, 100);
}

/** 變盤點數（每一條規則最多計一次）。 */
export function scoreTurningPoints(chart: NatalChart, placements: MutagenPlacement[], triggers: string[]): number {
  const find = (layer: LuckLayer, mutagen: Mutagen) => placements.find((p) => p.layer === layer && p.mutagen === mutagen);
  const nameAt = (index: number) => chart.palaces[index].name;
  let points = 0;
  const dayJi = find('流日', '忌');
  if (dayJi && ['命宮', '財帛'].includes(dayJi.palaceName)) { points += 2; triggers.push(`變盤：流日忌入${dayJi.palaceName}（+2）`); }
  if (dayJi && ['命宮', '財帛'].includes(nameAt(oppositeIndex(dayJi.palaceIndex)))) {
    points += 2; triggers.push(`變盤：流日忌沖${nameAt(oppositeIndex(dayJi.palaceIndex))}（+2）`);
  }
  const otherJi = [find('流年', '忌'), find('流月', '忌')].filter((p): p is MutagenPlacement => Boolean(p));
  if (dayJi && otherJi.some((p) => p.palaceIndex === dayJi.palaceIndex)) {
    points += 2; triggers.push('變盤：流日忌與流年／流月忌疊併（+2）');
  }
  const dayLu = find('流日', '祿');
  const jiLu = [dayLu && placements.find((p) => p.mutagen === '忌' && p.palaceIndex === dayLu.palaceIndex),
    dayJi && placements.find((p) => p.mutagen === '祿' && p.palaceIndex === dayJi.palaceIndex)].find(Boolean);
  if (jiLu) { points += 1; triggers.push(`變盤：祿忌同宮於${jiLu.palaceName}（+1）`); }
  const dayQuan = find('流日', '權');
  if (dayQuan && ['命宮', '遷移'].includes(dayQuan.palaceName)) { points += 1; triggers.push(`變盤：流日權入${dayQuan.palaceName}（+1）`); }
  return points;
}

/**
 * 變盤點數 → 強度：0–2 → 0、3 → 1、4 → 2、5 以上 → 3。
 * 門檻依 2016–2025 三個市場的「觸發頻率」校準（未看任何行情），讓強度 ≥ 2 約占 8–20% 的日子；
 * 若用 1 點就算變盤，三個市場有超過一半的日子都是變盤日，標記就失去意義。
 */
export function strengthFromPoints(points: number): 0 | 1 | 2 | 3 {
  if (points <= 2) return 0;
  if (points === 3) return 1;
  if (points === 4) return 2;
  return 3;
}

/** 計算某市場某日（市場當地日期）的紫微判讀。 */
export function evaluateZiweiDay(market: MetaMarket, tradeDate: string, chart: NatalChart = MARKET_NATAL_CHARTS[market]): ZiweiDayResult {
  const stems = luckStemsOf(tradeDate);
  const placements = placeMutagens(chart, stems);
  const triggers: string[] = [];
  const directionScore = scoreDirection(chart, placements, triggers);
  const turningPoints = scoreTurningPoints(chart, placements, triggers);
  return { market, tradeDate, stems, placements, directionScore, turningPoints,
    turningStrength: strengthFromPoints(turningPoints), triggers, ruleVersion: ZIWEI_RULE_VERSION };
}

/** 目前所在大限宮位（虛歲）；市場超過 120 歲（美股）時回傳 null，頁面顯示「超出大限範圍」。 */
export function currentDecadalPalace(chart: NatalChart, birthYear: number, currentYear: number) {
  const nominalAge = currentYear - birthYear + 1;
  return chart.palaces.find((p) => nominalAge >= p.decadalRange[0] && nominalAge <= p.decadalRange[1]) ?? null;
}
```

- [ ] **Step 4: 確認測試通過**

Run: `node --import tsx --test tests/metaphysics-ziwei.test.ts`
Expected: 6 個 test 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add app/services/metaphysics/ziweiTiming.ts tests/metaphysics-ziwei.test.ts
git commit -m "feat: 玄學羅盤紫微變盤規則 ziwei-v1"
```

---

### Task 4: 八字命局、運勢與疊加提示

**Files:**
- Create: `app/services/metaphysics/baziProfile.ts`
- Create: `app/services/metaphysics/baziLuck.ts`
- Create: `app/services/metaphysics/combinedHint.ts`
- Test: `tests/metaphysics-bazi.test.ts`

**Interfaces:**
- Consumes: ganzhi 全部匯出；`toTaipeiStandardTime`、`WallTime`、`addDays`、`parseIsoDate`（calendarTime）
- Produces:
  - `baziProfile.ts`：`interface BirthInput { calendar: 'solar'|'lunar'; year; month; day; isLeapMonth: boolean; hour; minute; hourUnknown: boolean; gender: 'male'|'female' }`、`interface Pillar { stem: Stem; branch: Branch }`、`type Strength = '身強'|'身弱'|'中和'`、`type InvestorLabel`、`interface DaYun { ganZhi; stem; branch; startYear; endYear; startAge }`、`interface BaziProfile { pillars: { year; month; day; hour: Pillar|null }; dayElement; strength; strengthScore; favorableGroups; unfavorableGroups; labels; daYun; dstCorrected; hourUnknown }`、`toStandardSolarWallTime(input)`、`scoreStrength(pillars): number`、`strengthOf(score): Strength`、`favorOf(strength)`、`investorLabels(pillars, strength): InvestorLabel[]`、`buildBaziProfile(input): BaziProfile`
  - `baziLuck.ts`：`type FiveGrade = '大吉'|'吉'|'平'|'凶'|'大凶'`、`type ThreeGrade`、`type LuckFlag = '財運佳'|'破財風險'|'變動'`、`interface PillarLuck { pillar; score; grade5; grade3; flags }`、`interface DailyLuck extends PillarLuck { date }`、`elementFavor(profile, element)`、`gradePillar(profile, pillar, natalDayBranch?): PillarLuck`、`flowPillarsOf(isoDate): { year; month; day: Pillar }`、`currentDaYun(profile, year): DaYun|null`、`dailyLuckRange(profile, startDate, days): DailyLuck[]`
  - `combinedHint.ts`：`type HintTone`、`interface CombinedHint { tone; text }`、`combinedHint(turningStrength, grade: FiveGrade): CombinedHint`

lunar-typescript 注意事項（規劃時已實測）：`getEightChar().setSect(1)` 才是 23:00 換日；`getYun(1)` 為男、`getYun(0)` 為女；`getDaYun()` 第 0 筆是起運前、干支為空字串要濾掉；lunar 的十神回傳簡體字，所以十神一律用自己的 `tenGodOf` 計算。

- [ ] **Step 1: 寫失敗的測試**

`tests/metaphysics-bazi.test.ts`：

```ts
/** @file 八字規則 bazi-v1：四柱（含子時換日、台灣舊時制、農曆閏月、時辰不明）、強弱、喜用、性格標籤、大運與運勢評分。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBaziProfile, favorOf, investorLabels, strengthOf, type BirthInput } from '../app/services/metaphysics/baziProfile';
import { currentDaYun, dailyLuckRange, flowPillarsOf, gradePillar } from '../app/services/metaphysics/baziLuck';
import { combinedHint } from '../app/services/metaphysics/combinedHint';

const base: BirthInput = { calendar: 'solar', year: 1990, month: 5, day: 20, isLeapMonth: false, hour: 23, minute: 30, hourUnknown: false, gender: 'male' };
const sample = buildBaziProfile(base);

test('1990-05-20 23:30 男：子時 23:00 換日，四柱為庚午 辛巳 丙戌 戊子', () => {
  assert.deepEqual(sample.pillars, {
    year: { stem: '庚', branch: '午' }, month: { stem: '辛', branch: '巳' },
    day: { stem: '丙', branch: '戌' }, hour: { stem: '戊', branch: '子' },
  });
  const beforeMidnight = buildBaziProfile({ ...base, hour: 22 });
  assert.deepEqual(beforeMidnight.pillars.day, { stem: '乙', branch: '酉' });
  assert.deepEqual(beforeMidnight.pillars.hour, { stem: '丁', branch: '亥' });
});

test('強弱與喜用：得令 3＋得地 2.5＋得勢 0 = 5.5 → 身強，喜財官食傷', () => {
  assert.equal(sample.strengthScore, 5.5);
  assert.equal(sample.strength, '身強');
  assert.deepEqual(sample.favorableGroups, ['財', '官殺', '食傷']);
  assert.deepEqual(sample.unfavorableGroups, ['印', '比劫']);
  assert.equal(strengthOf(5), '身強');
  assert.equal(strengthOf(2), '身弱');
  assert.equal(strengthOf(3.5), '中和');
  assert.deepEqual(favorOf('中和'), { favorable: ['財', '食傷'], unfavorable: [] });
});

test('性格標籤：偏財透干 → 機會型；食傷與財並見 → 研究型；只有正財 → 穩健型', () => {
  assert.deepEqual(sample.labels, ['機會型', '研究型']);
  const steady = investorLabels({
    year: { stem: '辛', branch: '酉' }, month: { stem: '甲', branch: '午' },
    day: { stem: '丙', branch: '寅' }, hour: { stem: '乙', branch: '未' },
  }, '中和');
  assert.deepEqual(steady, ['穩健型', '研究型']);
});

test('大運：男命順行，首步壬午 1995–2004；女命逆行首步庚辰', () => {
  assert.deepEqual(sample.daYun[0], { ganZhi: '壬午', stem: '壬', branch: '午', startYear: 1995, endYear: 2004, startAge: 6 });
  assert.equal(buildBaziProfile({ ...base, gender: 'female' }).daYun[0].ganZhi, '庚辰');
  assert.equal(currentDaYun(sample, 2026)?.ganZhi, '乙酉');
});

test('台灣日光節約：1975-06-15 09:30 修正為 08:30 辰時；1976 同時刻為巳時', () => {
  const dst = buildBaziProfile({ ...base, year: 1975, month: 6, day: 15, hour: 9 });
  assert.equal(dst.dstCorrected, true);
  assert.equal(dst.pillars.hour?.branch, '辰');
  const normal = buildBaziProfile({ ...base, year: 1976, month: 6, day: 15, hour: 9 });
  assert.equal(normal.dstCorrected, false);
  assert.equal(normal.pillars.hour?.branch, '巳');
});

test('時辰不明：只排三柱、以正午定日柱、不做時制修正', () => {
  const unknown = buildBaziProfile({ ...base, hour: 0, hourUnknown: true });
  assert.equal(unknown.pillars.hour, null);
  assert.deepEqual(unknown.pillars.day, { stem: '乙', branch: '酉' });
  assert.equal(unknown.dstCorrected, false);
  assert.equal(unknown.strength, '身弱');
});

test('農曆閏月：1990 閏五月初三 10:00 → 庚午 壬午 辛酉 癸巳', () => {
  const leap = buildBaziProfile({ ...base, calendar: 'lunar', month: 5, day: 3, isLeapMonth: true, hour: 10, minute: 0 });
  assert.deepEqual(leap.pillars, {
    year: { stem: '庚', branch: '午' }, month: { stem: '壬', branch: '午' },
    day: { stem: '辛', branch: '酉' }, hour: { stem: '癸', branch: '巳' },
  });
});

test('流年以立春換年、流月以節氣換月；2026-11-09 為丙午年己亥月丁亥日', () => {
  assert.deepEqual(flowPillarsOf('2026-11-09'), {
    year: { stem: '丙', branch: '午' }, month: { stem: '己', branch: '亥' }, day: { stem: '丁', branch: '亥' },
  });
  assert.deepEqual(flowPillarsOf('2026-02-03').year, { stem: '乙', branch: '巳' });
  assert.deepEqual(flowPillarsOf('2026-02-04').year, { stem: '丙', branch: '午' });
});

test('運勢評分：丙午流年大凶且破財風險；己亥流月大吉；壬辰日沖戌日支加註變動', () => {
  const flow = flowPillarsOf('2026-11-09');
  const year = gradePillar(sample, flow.year);
  assert.equal(year.grade5, '大凶');
  assert.deepEqual(year.flags, ['破財風險']);
  assert.equal(gradePillar(sample, flow.month).grade5, '大吉');
  const days = dailyLuckRange(sample, '2026-11-09', 12);
  assert.equal(days.length, 12);
  assert.deepEqual(days.map((d) => d.grade5).slice(0, 3), ['平', '大吉', '大吉']);
  const clashDay = days.find((d) => d.date === '2026-11-14')!;
  assert.deepEqual(clashDay.pillar, { stem: '壬', branch: '辰' });
  assert.ok(clashDay.flags.includes('變動'));
});

test('疊加提示：市場強度 ≥2 且個人凶 → 宜守；平穩且吉 → 順勢；平 → 平常心', () => {
  assert.equal(combinedHint(3, '大凶').tone, '宜守');
  assert.equal(combinedHint(2, '吉').tone, '動中有機');
  assert.equal(combinedHint(1, '大吉').tone, '順勢');
  assert.equal(combinedHint(0, '凶').tone, '少動');
  assert.equal(combinedHint(3, '平').tone, '平常心');
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `node --import tsx --test tests/metaphysics-bazi.test.ts`
Expected: FAIL，錯誤為找不到 `baziProfile` 模組。

- [ ] **Step 3: 實作 `app/services/metaphysics/baziProfile.ts`**

```ts
/**
 * @file 八字命局（規則 bazi-v1）：四柱、日主強弱、喜用神（扶抑法簡化版）、投資性格標籤、大運。
 * 純函式；不處理從格與調候。玄學參考，不構成投資建議。
 */
import { Lunar, Solar } from 'lunar-typescript';
import {
  HIDDEN_STEMS, branchElement, elementGroup, stemElement, tenGodGroup, tenGodOf,
  type Branch, type Element, type Stem, type TenGod, type TenGodGroup,
} from './ganzhi';
import { toTaipeiStandardTime, type WallTime } from './calendarTime';

/** 使用者輸入的生辰（加密保存的內容即此結構）。 */
export interface BirthInput {
  calendar: 'solar' | 'lunar';
  year: number;
  month: number;
  day: number;
  /** 農曆閏月；國曆時忽略。 */
  isLeapMonth: boolean;
  /** 0–23；hourUnknown 時忽略。 */
  hour: number;
  minute: number;
  hourUnknown: boolean;
  gender: 'male' | 'female';
}

export interface Pillar { stem: Stem; branch: Branch }
export type Strength = '身強' | '身弱' | '中和';
export type InvestorLabel = '機會型' | '穩健型' | '從眾型' | '研究型' | '冒險型' | '財多身弱' | '均衡型';

export interface DaYun { ganZhi: string; stem: Stem; branch: Branch; startYear: number; endYear: number; startAge: number }

export interface BaziProfile {
  pillars: { year: Pillar; month: Pillar; day: Pillar; hour: Pillar | null };
  dayElement: Element;
  strength: Strength;
  /** 日主強弱分數（得令＋得地＋得勢）。 */
  strengthScore: number;
  favorableGroups: TenGodGroup[];
  unfavorableGroups: TenGodGroup[];
  labels: InvestorLabel[];
  daYun: DaYun[];
  /** 是否套用了台灣舊日光節約時間修正。 */
  dstCorrected: boolean;
  hourUnknown: boolean;
}

/** 身強門檻：得令 3 分＋得地最多 4 分＋得勢最多 3 分，滿分 10；≥5 身強、≤2 身弱。 */
const STRONG_THRESHOLD = 5;
const WEAK_THRESHOLD = 2;
/** 時辰不明時用正午排盤：日柱不受子時換日影響，時柱則不使用。 */
const UNKNOWN_HOUR_PLACEHOLDER = 12;

/** 把輸入換成國曆牆上時間（農曆先轉國曆），再修正台灣舊日光節約時間。 */
export function toStandardSolarWallTime(input: BirthInput): { wall: WallTime; corrected: boolean } {
  const hour = input.hourUnknown ? UNKNOWN_HOUR_PLACEHOLDER : input.hour;
  const minute = input.hourUnknown ? 0 : input.minute;
  let wall: WallTime = { year: input.year, month: input.month, day: input.day, hour, minute };
  if (input.calendar === 'lunar') {
    const solar = Lunar.fromYmdHms(input.year, input.isLeapMonth ? -input.month : input.month, input.day, hour, minute, 0).getSolar();
    wall = { year: solar.getYear(), month: solar.getMonth(), day: solar.getDay(), hour, minute };
  }
  // 時辰不明時不修正：沒有可靠時間，修正 1 小時沒有意義。
  return input.hourUnknown ? { wall, corrected: false } : toTaipeiStandardTime(wall);
}

const isSupport = (group: TenGodGroup) => group === '比劫' || group === '印';

/** 日主強弱：得令（月支五行同我或生我 +3）＋得地（地支本氣助身 +1、僅中餘氣助身 +0.5）＋得勢（其他天干助身各 +1）。 */
export function scoreStrength(pillars: BaziProfile['pillars']): number {
  const dayStem = pillars.day.stem;
  const dayEl = stemElement(dayStem);
  const monthGroup = elementGroup(dayEl, branchElement(pillars.month.branch));
  let score = isSupport(monthGroup) ? 3 : 0;
  const branches = [pillars.year.branch, pillars.month.branch, pillars.day.branch, pillars.hour?.branch].filter((b): b is Branch => Boolean(b));
  for (const branch of branches) {
    const [main, ...rest] = HIDDEN_STEMS[branch];
    if (isSupport(tenGodGroup(tenGodOf(dayStem, main)))) score += 1;
    else if (rest.some((stem) => isSupport(tenGodGroup(tenGodOf(dayStem, stem))))) score += 0.5;
  }
  const otherStems = [pillars.year.stem, pillars.month.stem, pillars.hour?.stem].filter((s): s is Stem => Boolean(s));
  score += otherStems.filter((stem) => isSupport(tenGodGroup(tenGodOf(dayStem, stem)))).length;
  return score;
}

export function strengthOf(score: number): Strength {
  if (score >= STRONG_THRESHOLD) return '身強';
  if (score <= WEAK_THRESHOLD) return '身弱';
  return '中和';
}

/** 扶抑法簡化版：身弱喜印比、忌財官食傷；身強喜財官食傷、忌印比；中和喜財與食傷、無明顯忌神。 */
export function favorOf(strength: Strength): { favorable: TenGodGroup[]; unfavorable: TenGodGroup[] } {
  if (strength === '身弱') return { favorable: ['印', '比劫'], unfavorable: ['財', '官殺', '食傷'] };
  if (strength === '身強') return { favorable: ['財', '官殺', '食傷'], unfavorable: ['印', '比劫'] };
  return { favorable: ['財', '食傷'], unfavorable: [] };
}

/** 投資性格標籤：以「透干的三個天干（不含日干）＋地支本氣」的十神出現次數判斷。 */
export function investorLabels(pillars: BaziProfile['pillars'], strength: Strength): InvestorLabel[] {
  const dayStem = pillars.day.stem;
  const visibleStems = [pillars.year.stem, pillars.month.stem, pillars.hour?.stem].filter((s): s is Stem => Boolean(s));
  const branchMains = [pillars.year.branch, pillars.month.branch, pillars.day.branch, pillars.hour?.branch]
    .filter((b): b is Branch => Boolean(b)).map((b) => HIDDEN_STEMS[b][0]);
  const visibleGods = visibleStems.map((s) => tenGodOf(dayStem, s));
  const allGods: TenGod[] = [...visibleGods, ...branchMains.map((s) => tenGodOf(dayStem, s))];
  const count = (pred: (g: TenGod) => boolean) => allGods.filter(pred).length;
  const wealth = count((g) => tenGodGroup(g) === '財');
  const labels: InvestorLabel[] = [];
  if (visibleGods.includes('偏財') || count((g) => g === '偏財') >= 2) labels.push('機會型');
  if (count((g) => g === '正財') >= 1 && count((g) => g === '偏財') === 0) labels.push('穩健型');
  if (count((g) => tenGodGroup(g) === '比劫') >= 3) labels.push('從眾型');
  if (count((g) => tenGodGroup(g) === '食傷') >= 1 && wealth >= 1) labels.push('研究型');
  if (visibleGods.includes('七殺')) labels.push('冒險型');
  if (strength === '身弱' && wealth >= 3) labels.push('財多身弱');
  return labels.length > 0 ? labels : ['均衡型'];
}

/** 由生辰排出完整命局。子時以 23:00 換日（lunar-typescript sect 1）。 */
export function buildBaziProfile(input: BirthInput): BaziProfile {
  const { wall, corrected } = toStandardSolarWallTime(input);
  const solar = Solar.fromYmdHms(wall.year, wall.month, wall.day, wall.hour, wall.minute, 0);
  const eightChar = solar.getLunar().getEightChar();
  eightChar.setSect(1);
  const pillar = (stem: string, branch: string): Pillar => ({ stem: stem as Stem, branch: branch as Branch });
  const pillars: BaziProfile['pillars'] = {
    year: pillar(eightChar.getYearGan(), eightChar.getYearZhi()),
    month: pillar(eightChar.getMonthGan(), eightChar.getMonthZhi()),
    day: pillar(eightChar.getDayGan(), eightChar.getDayZhi()),
    hour: input.hourUnknown ? null : pillar(eightChar.getTimeGan(), eightChar.getTimeZhi()),
  };
  const strengthScore = scoreStrength(pillars);
  const strength = strengthOf(strengthScore);
  const { favorable, unfavorable } = favorOf(strength);
  // 大運第 0 筆是起運前（干支為空字串），不列入。
  const daYun = eightChar.getYun(input.gender === 'male' ? 1 : 0).getDaYun()
    .filter((d) => d.getGanZhi() !== '')
    .map((d) => ({ ganZhi: d.getGanZhi(), stem: d.getGanZhi()[0] as Stem, branch: d.getGanZhi()[1] as Branch,
      startYear: d.getStartYear(), endYear: d.getEndYear(), startAge: d.getStartAge() }));
  return { pillars, dayElement: stemElement(pillars.day.stem), strength, strengthScore, favorableGroups: favorable,
    unfavorableGroups: unfavorable, labels: investorLabels(pillars, strength), daYun, dstCorrected: corrected, hourUnknown: input.hourUnknown };
}
```

- [ ] **Step 4: 實作 `app/services/metaphysics/baziLuck.ts`**

```ts
/**
 * @file 八字運勢（規則 bazi-v1）：大運、流年、流月、流日對喜用神的生剋評分。
 * 純函式；輸出運勢等級與旗標，不包含任何標的或買賣動作。
 */
import { Solar } from 'lunar-typescript';
import { branchElement, branchesClash, elementGroup, stemElement, tenGodOf, type Branch, type Element, type Stem } from './ganzhi';
import { addDays, parseIsoDate } from './calendarTime';
import type { BaziProfile, DaYun, Pillar } from './baziProfile';

export type FiveGrade = '大吉' | '吉' | '平' | '凶' | '大凶';
export type ThreeGrade = '吉' | '平' | '凶';
export type LuckFlag = '財運佳' | '破財風險' | '變動';

export interface PillarLuck { pillar: Pillar; score: number; grade5: FiveGrade; grade3: ThreeGrade; flags: LuckFlag[] }
export interface DailyLuck extends PillarLuck { date: string }

/** 單一五行對此命局的喜忌：喜 +1、忌 -1、其他 0。 */
export function elementFavor(profile: BaziProfile, element: Element): number {
  const group = elementGroup(profile.dayElement, element);
  if (profile.favorableGroups.includes(group)) return 1;
  if (profile.unfavorableGroups.includes(group)) return -1;
  return 0;
}

const GRADE5: Record<number, FiveGrade> = { 2: '大吉', 1: '吉', 0: '平', [-1]: '凶', [-2]: '大凶' };

/**
 * 干支評分：天干五行喜忌 ＋ 地支本氣五行喜忌，範圍 -2～+2。
 * 旗標：
 * - 財運佳：干或支為財星，且日主不弱（身弱擔不起財）。
 * - 破財風險：天干為比肩或劫財（比劫奪財），且日主不弱；身弱時比劫反而是幫身。
 * - 變動：流日或流年地支沖日支（只在呼叫端傳入 natalDayBranch 時檢查）。
 */
export function gradePillar(profile: BaziProfile, pillar: Pillar, natalDayBranch?: Branch): PillarLuck {
  const stemEl = stemElement(pillar.stem), branchEl = branchElement(pillar.branch);
  const score = elementFavor(profile, stemEl) + elementFavor(profile, branchEl);
  const flags: LuckFlag[] = [];
  const notWeak = profile.strength !== '身弱';
  const isWealth = (el: Element) => elementGroup(profile.dayElement, el) === '財';
  if (notWeak && (isWealth(stemEl) || isWealth(branchEl))) flags.push('財運佳');
  const god = tenGodOf(profile.pillars.day.stem, pillar.stem);
  if (notWeak && (god === '比肩' || god === '劫財')) flags.push('破財風險');
  if (natalDayBranch && branchesClash(pillar.branch, natalDayBranch)) flags.push('變動');
  return { pillar, score, grade5: GRADE5[score], grade3: score > 0 ? '吉' : score < 0 ? '凶' : '平', flags };
}

/** 某國曆日期的流年（立春換年）、流月（節氣換月）、流日干支。 */
export function flowPillarsOf(isoDate: string): { year: Pillar; month: Pillar; day: Pillar } {
  const { year, month, day } = parseIsoDate(isoDate);
  const lunar = Solar.fromYmd(year, month, day).getLunar();
  const p = (stem: string, branch: string): Pillar => ({ stem: stem as Stem, branch: branch as Branch });
  return {
    year: p(lunar.getYearGanByLiChun(), lunar.getYearZhiByLiChun()),
    month: p(lunar.getMonthGanExact(), lunar.getMonthZhiExact()),
    day: p(lunar.getDayGan(), lunar.getDayZhi()),
  };
}

/** 目前所在大運（依國曆年份）；尚未起運回傳 null。 */
export function currentDaYun(profile: BaziProfile, year: number): DaYun | null {
  return profile.daYun.find((d) => year >= d.startYear && year <= d.endYear) ?? null;
}

/** 從 startDate 起連續 days 天的流日吉凶（台北日期）。 */
export function dailyLuckRange(profile: BaziProfile, startDate: string, days: number): DailyLuck[] {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(startDate, i);
    return { date, ...gradePillar(profile, flowPillarsOf(date).day, profile.pillars.day.branch) };
  });
}
```

- [ ] **Step 5: 實作 `app/services/metaphysics/combinedHint.ts`**

```ts
/** @file 市場變盤強度＋個人流日吉凶的疊加提示（模板文字）。只描述運勢，不包含任何標的或買賣動作。 */
import type { FiveGrade } from './baziLuck';

export type HintTone = '宜守' | '動中有機' | '順勢' | '少動' | '平常心';
export interface CombinedHint { tone: HintTone; text: string }

/** 市場變盤強度 ≥ 2 視為「易變盤」，與命中率統計的變盤門檻一致。 */
const VOLATILE_STRENGTH = 2;

export function combinedHint(turningStrength: number, grade: FiveGrade): CombinedHint {
  const volatile = turningStrength >= VOLATILE_STRENGTH;
  const good = grade === '吉' || grade === '大吉';
  const bad = grade === '凶' || grade === '大凶';
  if (volatile && bad) return { tone: '宜守', text: '市場易變盤，你今天財星受剋，宜守。' };
  if (volatile && good) return { tone: '動中有機', text: '市場易變盤，你今天運勢偏順，動中有機。' };
  if (!volatile && good) return { tone: '順勢', text: '盤勢平穩，你今天運勢偏順，可順勢而為。' };
  if (!volatile && bad) return { tone: '少動', text: '盤勢平穩，但你今天運勢偏弱，不宜衝動。' };
  return { tone: '平常心', text: '今天運勢平平，保持平常心。' };
}
```

- [ ] **Step 6: 確認測試通過**

Run: `node --import tsx --test tests/metaphysics-bazi.test.ts`
Expected: 10 個 test 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add app/services/metaphysics/baziProfile.ts app/services/metaphysics/baziLuck.ts app/services/metaphysics/combinedHint.ts tests/metaphysics-bazi.test.ts
git commit -m "feat: 玄學羅盤八字命局、運勢與疊加提示"
```

---

### Task 5: 命中率計算

**Files:**
- Create: `app/services/metaphysics/hitRate.ts`
- Test: `tests/metaphysics-hit-rate.test.ts`

**Interfaces:**
- Consumes: `type Candle`（`app/services/strategy/types.ts`）、`localDateOf`
- Produces: `interface DailyBar { date; close }`、`interface DayOutcome { date; changePct; isTurning }`、`DIRECTION_CALL_THRESHOLD = 30`、`TURNING_CALL_THRESHOLD = 2`、`dailyBarsFromCandles(candles, timeZone): DailyBar[]`、`classifyOutcomes(bars): DayOutcome[]`、`interface RateStat { hits; total; rate; low; high }`、`wilson(hits, total, z?): RateStat`、`interface ScoredRow { turningStrength; directionScore; actualChangePct: number|null; isTurningActual: boolean|null }`、`interface HitRateSummary`、`summarizeHitRate(rows): HitRateSummary`

- [ ] **Step 1: 寫失敗的測試**

`tests/metaphysics-hit-rate.test.ts`：

```ts
/** @file 命中率：實際變盤判定（大波動或連三日同向後反轉）、Wilson 區間、基準對照與時區日期換算。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyOutcomes, dailyBarsFromCandles, summarizeHitRate, wilson } from '../app/services/metaphysics/hitRate';

/** 前 21 根在 100、101 間來回震盪（平均波動約 1%），之後連漲三天再小跌、最後大漲。 */
const closes = [...Array.from({ length: 21 }, (_, i) => (i % 2 === 0 ? 100 : 101)), 102, 103, 104, 103.9, 110];
const bars = closes.map((close, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, close }));

test('實際變盤：大波動、連三日同向後反轉都算；普通漲跌不算；前 21 根資料不足不輸出', () => {
  const outcomes = classifyOutcomes(bars);
  assert.deepEqual(outcomes.map((o) => o.date), ['2026-01-22', '2026-01-23', '2026-01-24', '2026-01-25', '2026-01-26']);
  assert.deepEqual(outcomes.map((o) => o.isTurning), [true, false, false, true, true]);
  assert.equal(outcomes[0].changePct, 2);
});

test('Wilson 95% 區間：30/50 約 0.462–0.724；樣本 0 回傳 null', () => {
  const stat = wilson(30, 50);
  assert.equal(stat.rate, 0.6);
  assert.ok(Math.abs(stat.low! - 0.4618) < 0.001);
  assert.ok(Math.abs(stat.high! - 0.7239) < 0.001);
  assert.deepEqual(wilson(0, 0), { hits: 0, total: 0, rate: null, low: null, high: null });
});

test('命中率摘要：只計有實際結果的列；方向基準是一直猜漲', () => {
  const rows = [
    { turningStrength: 3, directionScore: 40, actualChangePct: 2, isTurningActual: true },
    { turningStrength: 2, directionScore: -35, actualChangePct: 1, isTurningActual: false },
    { turningStrength: 0, directionScore: 5, actualChangePct: -1, isTurningActual: false },
    { turningStrength: 3, directionScore: 50, actualChangePct: null, isTurningActual: null },
  ];
  const summary = summarizeHitRate(rows);
  assert.equal(summary.turning.total, 2);
  assert.equal(summary.turning.hits, 1);
  assert.equal(summary.turningBaseline.total, 3);
  assert.equal(summary.turningBaseline.hits, 1);
  assert.equal(summary.direction.total, 2);
  assert.equal(summary.direction.hits, 1);
  assert.equal(summary.directionBaseline.hits, 2);
  assert.equal(summary.turningDistinguishable, false);
});

test('日線換當地日期：紐約 2026-11-09 01:00 UTC 屬於 11-08', () => {
  const candle = (openTime: number, close: number) => ({ openTime, open: close, high: close, low: close, close, volume: 0 });
  assert.deepEqual(dailyBarsFromCandles([candle(Date.UTC(2026, 10, 9, 14, 30), 6), candle(Date.UTC(2026, 10, 9, 1), 5)], 'America/New_York'),
    [{ date: '2026-11-08', close: 5 }, { date: '2026-11-09', close: 6 }]);
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `node --import tsx --test tests/metaphysics-hit-rate.test.ts`
Expected: FAIL，錯誤為找不到 `hitRate` 模組。

- [ ] **Step 3: 實作 `app/services/metaphysics/hitRate.ts`**

```ts
/**
 * @file 玄學預測命中率：實際變盤判定、命中率、基準機率與 Wilson 95% 信賴區間。純函式，不抓行情。
 * 基準機率是關鍵：任何一天本來就有一定機率大波動，玄學命中率要明顯高於基準才有參考價值。
 */
import type { Candle } from '../strategy/types';
import { localDateOf } from './calendarTime';

/** 某市場當地日期的收盤價。 */
export interface DailyBar { date: string; close: number }
/** 某日的實際結果。 */
export interface DayOutcome { date: string; changePct: number; isTurning: boolean }

/** 大波動倍數：當日漲跌幅絕對值 ≥ 前 20 日平均漲跌幅絕對值 × 1.5 視為大波動。 */
const BIG_MOVE_MULTIPLIER = 1.5;
/** 平均波動回看天數（交易日）。 */
const VOLATILITY_LOOKBACK = 20;
/** 反轉判定：前 3 日連續同向、當日反向。 */
const TREND_DAYS = 3;
/** 方向表態門檻：|方向分數| ≥ 30 才算有表態。 */
export const DIRECTION_CALL_THRESHOLD = 30;
/** 變盤預測門檻：強度 ≥ 2 才算預測變盤。 */
export const TURNING_CALL_THRESHOLD = 2;

/** K 線 → 當地日期收盤序列（同一日期多根時保留最後一根）。 */
export function dailyBarsFromCandles(candles: Candle[], timeZone: string): DailyBar[] {
  const byDate = new Map<string, number>();
  for (const candle of [...candles].sort((a, b) => a.openTime - b.openTime)) byDate.set(localDateOf(candle.openTime, timeZone), candle.close);
  return [...byDate.entries()].map(([date, close]) => ({ date, close }));
}

/** 逐日判定實際是否變盤；前 VOLATILITY_LOOKBACK+1 根資料不足，不輸出。 */
export function classifyOutcomes(bars: DailyBar[]): DayOutcome[] {
  const changes = bars.map((bar, i) => (i === 0 ? 0 : (bar.close / bars[i - 1].close - 1) * 100));
  const outcomes: DayOutcome[] = [];
  for (let i = VOLATILITY_LOOKBACK + 1; i < bars.length; i++) {
    const window = changes.slice(i - VOLATILITY_LOOKBACK, i);
    const avgAbs = window.reduce((sum, c) => sum + Math.abs(c), 0) / VOLATILITY_LOOKBACK;
    const bigMove = avgAbs > 0 && Math.abs(changes[i]) >= avgAbs * BIG_MOVE_MULTIPLIER;
    const recent = changes.slice(i - TREND_DAYS, i);
    const trendSign = recent.every((c) => c > 0) ? 1 : recent.every((c) => c < 0) ? -1 : 0;
    const reversal = trendSign !== 0 && Math.sign(changes[i]) === -trendSign;
    outcomes.push({ date: bars[i].date, changePct: Math.round(changes[i] * 10000) / 10000, isTurning: bigMove || reversal });
  }
  return outcomes;
}

export interface RateStat { hits: number; total: number; rate: number | null; low: number | null; high: number | null }

/** Wilson 95% 信賴區間（z = 1.96）；樣本為 0 時回傳 null。 */
export function wilson(hits: number, total: number, z = 1.96): RateStat {
  if (total === 0) return { hits, total, rate: null, low: null, high: null };
  const p = hits / total, denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom;
  return { hits, total, rate: p, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

/** 命中率統計輸入：一筆預測加上實際結果（實際結果為空的列不計）。 */
export interface ScoredRow { turningStrength: number; directionScore: number; actualChangePct: number | null; isTurningActual: boolean | null }

export interface HitRateSummary {
  turning: RateStat;
  turningBaseline: RateStat;
  direction: RateStat;
  directionBaseline: RateStat;
  /** 玄學區間與基準區間不重疊，才算「與隨機有差異」。 */
  turningDistinguishable: boolean;
  directionDistinguishable: boolean;
}

const separated = (a: RateStat, b: RateStat) =>
  a.low != null && a.high != null && b.low != null && b.high != null && (a.low > b.high || a.high < b.low);

export function summarizeHitRate(rows: ScoredRow[]): HitRateSummary {
  const scored = rows.filter((r): r is ScoredRow & { actualChangePct: number; isTurningActual: boolean } =>
    r.actualChangePct != null && r.isTurningActual != null);
  const turningCalls = scored.filter((r) => r.turningStrength >= TURNING_CALL_THRESHOLD);
  const turning = wilson(turningCalls.filter((r) => r.isTurningActual).length, turningCalls.length);
  const turningBaseline = wilson(scored.filter((r) => r.isTurningActual).length, scored.length);
  const directionCalls = scored.filter((r) => Math.abs(r.directionScore) >= DIRECTION_CALL_THRESHOLD && r.actualChangePct !== 0);
  const direction = wilson(directionCalls.filter((r) => Math.sign(r.directionScore) === Math.sign(r.actualChangePct)).length, directionCalls.length);
  const nonFlat = scored.filter((r) => r.actualChangePct !== 0);
  // 基準：同期間「一直猜漲」的命中率。
  const directionBaseline = wilson(nonFlat.filter((r) => r.actualChangePct > 0).length, nonFlat.length);
  return { turning, turningBaseline, direction, directionBaseline,
    turningDistinguishable: separated(turning, turningBaseline), directionDistinguishable: separated(direction, directionBaseline) };
}
```

- [ ] **Step 4: 確認測試通過**

Run: `node --import tsx --test tests/metaphysics-hit-rate.test.ts`
Expected: 4 個 test 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add app/services/metaphysics/hitRate.ts tests/metaphysics-hit-rate.test.ts
git commit -m "feat: 玄學羅盤命中率與基準機率計算"
```

---

### Task 6: 資料表、生辰加密存取、預測快照、AI 解說快取

**Files:**
- Create: `drizzle/0031_metaphysics.sql`
- Create: `app/db/metaphysicsSchema.ts`
- Create: `app/services/metaphysics/birthInput.ts`
- Create: `app/services/metaphysics/birthProfileStore.server.ts`
- Create: `app/services/metaphysics/forecastStore.server.ts`
- Create: `app/services/metaphysics/narrative.server.ts`
- Test: `tests/metaphysics-store.integration.test.ts`

**Interfaces:**
- Consumes: `users`（`app/db/schema.ts`）、`encryptData`／`decryptData`、`BirthInput`、`DayOutcome`、`ScoredRow`、`ZiweiDayResult`、`ZIWEI_RULE_VERSION`、`MetaMarket`
- Produces:
  - `metaphysicsSchema.ts`：`userBirthProfiles`、`metaphysicsMarketForecasts`、`metaphysicsNarrativeCache`
  - `birthInput.ts`：`type BirthParseResult`、`parseBirthForm(form: FormData, currentYear: number): BirthParseResult`
  - `birthProfileStore.server.ts`：`type D1Binding`、`saveBirthProfile(db, masterKey, userId, input, now?)`、`loadBirthProfile(db, masterKey, userId): Promise<BirthInput|null>`、`deleteBirthProfile(db, userId)`
  - `forecastStore.server.ts`：`type ForecastSource = 'live'|'backtest'`、`shouldSnapshot(market, tradeDate): boolean`、`recordLiveForecast(db, result, now?)`、`listPendingLiveDates(db, market, beforeDate): Promise<string[]>`、`applyOutcomes(db, market, outcomes): Promise<number>`、`loadScoredRows(db, market, source): Promise<ScoredRow[]>`
  - `narrative.server.ts`：`type NarrativeKind`、`type NarrativeSource`、`buildNarrativePrompt(kind, facts)`、`interface NarrativeRequest`、`getNarrative(request): Promise<{ text; source }>`

D1 會檢查外鍵，所以整合測試先建最小 `users` 表再套 migration。migration 只新增表，不改任何既有表。

- [ ] **Step 1: 寫失敗的測試**

`tests/metaphysics-store.integration.test.ts`：

```ts
/** @file 玄學羅盤 D1 整合測試（Miniflare）：生辰加密存取、表單驗證、預測快照去重與回填、AI 解說快取與模板 fallback。不連外部網路。 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { parseBirthForm } from '../app/services/metaphysics/birthInput';
import { deleteBirthProfile, loadBirthProfile, saveBirthProfile } from '../app/services/metaphysics/birthProfileStore.server';
import { applyOutcomes, listPendingLiveDates, loadScoredRows, recordLiveForecast, shouldSnapshot } from '../app/services/metaphysics/forecastStore.server';
import { getNarrative } from '../app/services/metaphysics/narrative.server';
import { evaluateZiweiDay } from '../app/services/metaphysics/ziweiTiming';
import type { BirthInput } from '../app/services/metaphysics/baziProfile';

const birth: BirthInput = { calendar: 'solar', year: 1990, month: 5, day: 20, isLeapMonth: false, hour: 23, minute: 30, hourUnknown: false, gender: 'male' };

/** 建立只含 users 最小欄位與 migration 0031 的 D1；D1 會檢查外鍵，所以要先有 users。 */
async function withDb(run: (db: any) => Promise<void>) {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: ['DB'] });
  try {
    const db = await mf.getD1Database('DB');
    await db.prepare('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, password_hash TEXT NOT NULL)').run();
    await db.prepare("INSERT INTO users (id, email, password_hash) VALUES (7, 'a@example.test', 'x')").run();
    const migration = await readFile(new URL('../drizzle/0031_metaphysics.sql', import.meta.url), 'utf8');
    await db.batch(migration.split('--> statement-breakpoint').map((sql) => db.prepare(sql.trim())));
    await run(db);
  } finally {
    await mf.dispose();
  }
}

test('生辰加密保存：DB 內看不到明文，正確金鑰可讀回，錯誤金鑰視同未填，刪除後為 null', async () => {
  await withDb(async (db) => {
    await saveBirthProfile(db, 'master-key-for-test', 7, birth);
    const raw = await db.prepare('SELECT encrypted_payload FROM user_birth_profiles WHERE user_id = 7').first();
    assert.equal(String(raw.encrypted_payload).includes('1990'), false);
    assert.deepEqual(await loadBirthProfile(db, 'master-key-for-test', 7), birth);
    assert.equal(await loadBirthProfile(db, 'wrong-key', 7), null);
    await assert.rejects(saveBirthProfile(db, undefined, 7, birth), /MASTER_ENCRYPTION_KEY/);
    await deleteBirthProfile(db, 7);
    assert.equal(await loadBirthProfile(db, 'master-key-for-test', 7), null);
  });
});

test('生辰表單驗證：不存在的國曆日、沒有的閏月、超過天數、時間缺漏都擋下', () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries({ calendar: 'solar', gender: 'male', year: '1990', month: '5', day: '20', hour: '23', minute: '30', ...fields })) data.set(k, v);
    return data;
  };
  assert.deepEqual(parseBirthForm(form({}), 2026), { ok: true, value: birth });
  assert.equal(parseBirthForm(form({ month: '2', day: '30' }), 2026).ok, false);
  assert.match((parseBirthForm(form({ calendar: 'lunar', year: '2024', month: '2', isLeapMonth: 'on', day: '1' }), 2026) as { error: string }).error, /沒有閏2月/);
  assert.match((parseBirthForm(form({ calendar: 'lunar', year: '2023', month: '1', day: '30' }), 2026) as { error: string }).error, /只有 29 天/);
  assert.equal(parseBirthForm(form({ hour: '' }), 2026).ok, false);
  const unknown = parseBirthForm(form({ hour: '', minute: '', hourUnknown: 'on' }), 2026);
  assert.equal(unknown.ok && unknown.value.hourUnknown, true);
});

test('預測快照：同日不重複寫入；週末股市不建立；回填後可統計', async () => {
  await withDb(async (db) => {
    const result = evaluateZiweiDay('TW', '2026-11-09');
    await recordLiveForecast(db, result, 1);
    await recordLiveForecast(db, { ...result, directionScore: 99 }, 2);
    const rows = await db.prepare('SELECT direction_score FROM metaphysics_market_forecasts').all();
    assert.deepEqual(rows.results.map((r: any) => r.direction_score), [9]);
    assert.equal(shouldSnapshot('TW', '2026-11-08'), false);
    assert.equal(shouldSnapshot('CRYPTO', '2026-11-08'), true);
    assert.deepEqual(await listPendingLiveDates(db, 'TW', '2026-11-10'), ['2026-11-09']);
    assert.equal(await applyOutcomes(db, 'TW', [{ date: '2026-11-09', changePct: -1.2, isTurning: true }]), 1);
    assert.deepEqual(await listPendingLiveDates(db, 'TW', '2026-11-10'), []);
    assert.deepEqual(await loadScoredRows(db, 'TW', 'live'),
      [{ turningStrength: 1, directionScore: 9, actualChangePct: -1.2, isTurningActual: true }]);
  });
});

test('AI 解說：第一次呼叫 AI 並快取，第二次讀快取；AI 失敗回模板且不寫快取', async () => {
  await withDb(async (db) => {
    let calls = 0;
    const request = { db, env: {}, userId: 0, kind: 'market_TW' as const, cacheDate: '2026-11-09', ruleVersion: 'ziwei-v1',
      facts: ['流日巨門化忌入財帛'], fallback: '模板文字', ai: async (prompt: string) => { calls++; assert.match(prompt, /不得提到任何個股/); return '今日財帛受忌。'; } };
    assert.deepEqual(await getNarrative(request), { text: '今日財帛受忌。', source: 'ai' });
    assert.deepEqual(await getNarrative(request), { text: '今日財帛受忌。', source: 'cache' });
    assert.equal(calls, 1);
    const failing = { ...request, kind: 'market_US' as const, ai: async () => { throw new Error('quota'); } };
    assert.deepEqual(await getNarrative(failing), { text: '模板文字', source: 'template' });
    const cached = await db.prepare("SELECT COUNT(*) AS n FROM metaphysics_narrative_cache WHERE kind = 'market_US'").first();
    assert.equal(cached.n, 0);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `node --import tsx --test tests/metaphysics-store.integration.test.ts`
Expected: FAIL，錯誤為找不到 `0031_metaphysics.sql` 或 `birthInput` 模組。

- [ ] **Step 3: 建立 migration `drizzle/0031_metaphysics.sql`**

```sql
-- 玄學羅盤：加密生辰、每日紫微預測快照（上線與回測）、AI 解說快取。不修改任何既有資料表。
CREATE TABLE IF NOT EXISTS user_birth_profiles (
  user_id INTEGER PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS metaphysics_market_forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  market TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  source TEXT NOT NULL,
  direction_score INTEGER NOT NULL,
  turning_strength INTEGER NOT NULL,
  triggers_json TEXT NOT NULL,
  actual_change_pct REAL,
  is_turning_actual INTEGER,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS metaphysics_forecast_unique ON metaphysics_market_forecasts (market, trade_date, rule_version, source);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS metaphysics_narrative_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  user_id INTEGER NOT NULL DEFAULT 0,
  cache_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS metaphysics_narrative_unique ON metaphysics_narrative_cache (user_id, cache_date, kind, rule_version);
```

- [ ] **Step 4: 建立 `app/db/metaphysicsSchema.ts`**

```ts
/** @file 玄學羅盤資料表（migration 0031）：加密生辰、每日紫微預測快照、AI 解說快取。與交易、風控資料表完全分開。 */
import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './schema';

/** 使用者生辰；整包 AES-GCM 加密（含性別），刪除帳號時一併刪除。 */
export const userBirthProfiles = sqliteTable('user_birth_profiles', {
  userId: integer('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  /** encryptData(JSON.stringify(BirthInput), MASTER_ENCRYPTION_KEY) 的結果。 */
  encryptedPayload: text('encrypted_payload').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 每日紫微預測；source = 'live'（上線後頁面瀏覽時建立）或 'backtest'（回測腳本匯入）。 */
export const metaphysicsMarketForecasts = sqliteTable('metaphysics_market_forecasts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** 'TW' | 'CRYPTO' | 'US'。 */
  market: text('market').notNull(),
  /** 市場當地日期 YYYY-MM-DD。 */
  tradeDate: text('trade_date').notNull(),
  ruleVersion: text('rule_version').notNull(),
  source: text('source').notNull(),
  /** 方向分數 -100～+100。 */
  directionScore: integer('direction_score').notNull(),
  /** 變盤強度 0–3。 */
  turningStrength: integer('turning_strength').notNull(),
  triggersJson: text('triggers_json').notNull(),
  /** 當日實際漲跌幅（%），收盤後回填；休市或尚未回填為 null。 */
  actualChangePct: real('actual_change_pct'),
  /** 實際是否變盤（1/0），定義見 hitRate.ts。 */
  isTurningActual: integer('is_turning_actual'),
  createdAt: integer('created_at').notNull(),
}, (t) => [uniqueIndex('metaphysics_forecast_unique').on(t.market, t.tradeDate, t.ruleVersion, t.source)]);

/** AI 解說快取；市場解說 userId = 0（SQLite 唯一索引中 NULL 互不相等，用 0 才能去重）。 */
export const metaphysicsNarrativeCache = sqliteTable('metaphysics_narrative_cache', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().default(0),
  /** 台北日期 YYYY-MM-DD。 */
  cacheDate: text('cache_date').notNull(),
  /** 'market_TW' | 'market_CRYPTO' | 'market_US' | 'bazi_profile' | 'bazi_daily'。 */
  kind: text('kind').notNull(),
  ruleVersion: text('rule_version').notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => [uniqueIndex('metaphysics_narrative_unique').on(t.userId, t.cacheDate, t.kind, t.ruleVersion)]);
```

- [ ] **Step 5: 實作 `app/services/metaphysics/birthInput.ts`**

```ts
/** @file 生辰表單驗證（純函式）：檢查國曆／農曆日期合法、閏月存在、時分範圍。 */
import { LunarMonth } from 'lunar-typescript';
import type { BirthInput } from './baziProfile';

export type BirthParseResult = { ok: true; value: BirthInput } | { ok: false; error: string };

/** 最早可輸入年份：lunar-typescript 支援更早，但台灣時制修正表只涵蓋 1900 年以後。 */
const MIN_YEAR = 1900;

const toInt = (value: FormDataEntryValue | null): number => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN);
const inRange = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;

export function parseBirthForm(form: FormData, currentYear: number): BirthParseResult {
  const calendar = form.get('calendar');
  const gender = form.get('gender');
  if (calendar !== 'solar' && calendar !== 'lunar') return { ok: false, error: '請選擇國曆或農曆' };
  if (gender !== 'male' && gender !== 'female') return { ok: false, error: '請選擇性別（決定大運順行或逆行）' };
  const year = toInt(form.get('year')), month = toInt(form.get('month')), day = toInt(form.get('day'));
  if (!inRange(year, MIN_YEAR, currentYear) || !inRange(month, 1, 12) || !inRange(day, 1, 31)) {
    return { ok: false, error: `出生日期不正確（年份需介於 ${MIN_YEAR}–${currentYear}）` };
  }
  const isLeapMonth = calendar === 'lunar' && form.get('isLeapMonth') === 'on';
  if (calendar === 'solar') {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1) return { ok: false, error: '國曆日期不存在' };
  } else {
    const lunarMonth = LunarMonth.fromYm(year, isLeapMonth ? -month : month);
    if (!lunarMonth) return { ok: false, error: isLeapMonth ? `農曆 ${year} 年沒有閏${month}月` : '農曆日期不正確' };
    if (day > lunarMonth.getDayCount()) return { ok: false, error: `農曆該月只有 ${lunarMonth.getDayCount()} 天` };
  }
  const hourUnknown = form.get('hourUnknown') === 'on';
  const hour = hourUnknown ? 0 : toInt(form.get('hour'));
  const minute = hourUnknown ? 0 : toInt(form.get('minute'));
  if (!hourUnknown && (!inRange(hour, 0, 23) || !inRange(minute, 0, 59))) return { ok: false, error: '出生時間不正確，或請勾選「時辰不明」' };
  return { ok: true, value: { calendar, year, month, day, isLeapMonth, hour, minute, hourUnknown, gender } };
}
```

- [ ] **Step 6: 實作 `app/services/metaphysics/birthProfileStore.server.ts`**

```ts
/**
 * @file 生辰加密存取。副作用：讀寫 D1 `user_birth_profiles`、刪除時一併清除該使用者的 AI 解說快取。
 * 生辰屬個人敏感資料，整包加密（含性別）；解密失敗視同未填，不讓頁面崩潰。
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { metaphysicsNarrativeCache, userBirthProfiles } from '../../db/metaphysicsSchema';
import { decryptData, encryptData } from '../../utils/encryption';
import type { BirthInput } from './baziProfile';

/** Cloudflare D1 binding（與 macro/snapshotStore 相同寫法，避免直接依賴 workers-types）。 */
export type D1Binding = Parameters<typeof drizzle>[0];

export async function saveBirthProfile(db: D1Binding, masterKey: string | undefined, userId: number, input: BirthInput, now = Date.now()): Promise<void> {
  if (!masterKey) throw new Error('未設定 MASTER_ENCRYPTION_KEY，無法加密保存生辰');
  const encryptedPayload = await encryptData(JSON.stringify(input), masterKey);
  await drizzle(db).insert(userBirthProfiles).values({ userId, encryptedPayload, updatedAt: now })
    .onConflictDoUpdate({ target: userBirthProfiles.userId, set: { encryptedPayload, updatedAt: now } }).run();
  // 生辰變了，舊的個人解說不再適用。
  await drizzle(db).delete(metaphysicsNarrativeCache).where(eq(metaphysicsNarrativeCache.userId, userId)).run();
}

export async function loadBirthProfile(db: D1Binding, masterKey: string | undefined, userId: number): Promise<BirthInput | null> {
  const row = await drizzle(db).select().from(userBirthProfiles).where(eq(userBirthProfiles.userId, userId)).get();
  if (!row) return null;
  if (!masterKey) { console.error('[Metaphysics] 未設定 MASTER_ENCRYPTION_KEY，無法解密生辰'); return null; }
  try {
    return JSON.parse(await decryptData(row.encryptedPayload, masterKey)) as BirthInput;
  } catch (error) {
    console.error('[Metaphysics] 生辰解密失敗，視同未填', error);
    return null;
  }
}

export async function deleteBirthProfile(db: D1Binding, userId: number): Promise<void> {
  await drizzle(db).delete(userBirthProfiles).where(eq(userBirthProfiles.userId, userId)).run();
  await drizzle(db).delete(metaphysicsNarrativeCache).where(eq(metaphysicsNarrativeCache.userId, userId)).run();
}
```

- [ ] **Step 7: 實作 `app/services/metaphysics/forecastStore.server.ts`**

```ts
/**
 * @file 每日紫微預測快照的寫入、回填與讀取。副作用：寫入 D1 `metaphysics_market_forecasts`。
 * 只存規則算出的結果，不影響任何交易或羅盤資料；寫入失敗由呼叫端吞掉並記 log。
 */
import { and, eq, isNull, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { metaphysicsMarketForecasts } from '../../db/metaphysicsSchema';
import type { D1Binding } from './birthProfileStore.server';
import type { DayOutcome, ScoredRow } from './hitRate';
import type { MetaMarket } from './marketChartSpecs';
import { ZIWEI_RULE_VERSION, type ZiweiDayResult } from './types';

export type ForecastSource = 'live' | 'backtest';

/** 台股、美股只在週一至週五建立快照（休市日沒有行情可回填）；BTC 全年無休。 */
export function shouldSnapshot(market: MetaMarket, tradeDate: string): boolean {
  if (market === 'CRYPTO') return true;
  const weekday = new Date(`${tradeDate}T00:00:00Z`).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

/** 寫入當日上線快照；同一天同版本已存在就不覆寫（保留「當時頁面顯示的內容」）。 */
export async function recordLiveForecast(db: D1Binding, result: ZiweiDayResult, now = Date.now()): Promise<void> {
  await drizzle(db).insert(metaphysicsMarketForecasts).values({
    market: result.market, tradeDate: result.tradeDate, ruleVersion: result.ruleVersion, source: 'live',
    directionScore: result.directionScore, turningStrength: result.turningStrength,
    triggersJson: JSON.stringify(result.triggers), createdAt: now,
  }).onConflictDoNothing().run();
}

/** 尚未回填實際結果、且日期早於 beforeDate 的上線快照日期。 */
export async function listPendingLiveDates(db: D1Binding, market: MetaMarket, beforeDate: string): Promise<string[]> {
  const rows = await drizzle(db).select({ tradeDate: metaphysicsMarketForecasts.tradeDate }).from(metaphysicsMarketForecasts)
    .where(and(eq(metaphysicsMarketForecasts.market, market), eq(metaphysicsMarketForecasts.source, 'live'),
      eq(metaphysicsMarketForecasts.ruleVersion, ZIWEI_RULE_VERSION), isNull(metaphysicsMarketForecasts.actualChangePct),
      lt(metaphysicsMarketForecasts.tradeDate, beforeDate))).all();
  return rows.map((row) => row.tradeDate);
}

/** 把實際結果回填到對應日期的上線快照；回傳更新筆數。 */
export async function applyOutcomes(db: D1Binding, market: MetaMarket, outcomes: DayOutcome[]): Promise<number> {
  let updated = 0;
  for (const outcome of outcomes) {
    const result = await drizzle(db).update(metaphysicsMarketForecasts)
      .set({ actualChangePct: outcome.changePct, isTurningActual: outcome.isTurning ? 1 : 0 })
      .where(and(eq(metaphysicsMarketForecasts.market, market), eq(metaphysicsMarketForecasts.tradeDate, outcome.date),
        eq(metaphysicsMarketForecasts.source, 'live'), isNull(metaphysicsMarketForecasts.actualChangePct))).run();
    updated += result.meta.changes ?? 0;
  }
  return updated;
}

/** 讀取某市場、某來源、目前規則版本的所有預測，供命中率統計。 */
export async function loadScoredRows(db: D1Binding, market: MetaMarket, source: ForecastSource): Promise<ScoredRow[]> {
  const rows = await drizzle(db).select().from(metaphysicsMarketForecasts)
    .where(and(eq(metaphysicsMarketForecasts.market, market), eq(metaphysicsMarketForecasts.source, source),
      eq(metaphysicsMarketForecasts.ruleVersion, ZIWEI_RULE_VERSION))).all();
  return rows.map((row) => ({ turningStrength: row.turningStrength, directionScore: row.directionScore,
    actualChangePct: row.actualChangePct, isTurningActual: row.isTurningActual == null ? null : row.isTurningActual === 1 }));
}
```

- [ ] **Step 8: 實作 `app/services/metaphysics/narrative.server.ts`**

```ts
/**
 * @file AI 解說：把規則層的結果交給既有 aiService 寫成白話，每人每天每種只產生一次並快取。
 * 外部 API 副作用：呼叫 AI 供應商（依 AI_PROVIDER）。逾時或失敗時改回傳模板文字且不寫快取，下次再試。
 * 隱私：送給 AI 的內容只能是衍生標籤，不得包含出生年月日時或四柱干支。
 */
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { metaphysicsNarrativeCache } from '../../db/metaphysicsSchema';
import type { D1Binding } from './birthProfileStore.server';

export type NarrativeKind = 'market_TW' | 'market_CRYPTO' | 'market_US' | 'bazi_profile' | 'bazi_daily';
export type NarrativeSource = 'cache' | 'ai' | 'template';

/** AI 呼叫逾時（毫秒）：解說是附加內容，等太久不如先給模板。 */
const AI_TIMEOUT_MS = 8000;

/** 共用的寫作指示：強調玄學參考、禁止個股與買賣指令。 */
const STYLE_RULES = [
  '請用繁體中文寫 120 字以內的白話解說，語氣平實。',
  '這是玄學參考，不是投資建議；不得提到任何個股、代號、價位，也不得給買進或賣出指示。',
  '只根據下列資料解說，不要自行補充其他命理推論。',
].join('\n');

export function buildNarrativePrompt(kind: NarrativeKind, facts: string[]): string {
  const subject = kind.startsWith('market_') ? '紫微斗數市場本命盤的當日四化' : '使用者八字的命局與運勢等級';
  return `${STYLE_RULES}\n主題：${subject}\n資料：\n${facts.map((f) => `- ${f}`).join('\n')}`;
}

export interface NarrativeRequest {
  db: D1Binding;
  env: Record<string, unknown>;
  /** 市場解說傳 0。 */
  userId: number;
  kind: NarrativeKind;
  /** 台北日期 YYYY-MM-DD。 */
  cacheDate: string;
  ruleVersion: string;
  facts: string[];
  /** AI 失敗時顯示的模板文字。 */
  fallback: string;
  /** 測試時注入假的 AI；預設為 aiService.getAIResponse。 */
  ai?: (prompt: string, env: Record<string, unknown>) => Promise<string>;
}

async function defaultAi(prompt: string, env: Record<string, unknown>): Promise<string> {
  const { getAIResponse } = await import('../aiService');
  return getAIResponse(prompt, {}, env);
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('AI 逾時')), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

export async function getNarrative(request: NarrativeRequest): Promise<{ text: string; source: NarrativeSource }> {
  const orm = drizzle(request.db);
  const key = and(eq(metaphysicsNarrativeCache.userId, request.userId), eq(metaphysicsNarrativeCache.cacheDate, request.cacheDate),
    eq(metaphysicsNarrativeCache.kind, request.kind), eq(metaphysicsNarrativeCache.ruleVersion, request.ruleVersion));
  const cached = await orm.select().from(metaphysicsNarrativeCache).where(key).get();
  if (cached) return { text: cached.content, source: 'cache' };
  try {
    const text = (await withTimeout((request.ai ?? defaultAi)(buildNarrativePrompt(request.kind, request.facts), request.env), AI_TIMEOUT_MS)).trim();
    if (!text) throw new Error('AI 回傳空白');
    await orm.insert(metaphysicsNarrativeCache).values({ userId: request.userId, cacheDate: request.cacheDate, kind: request.kind,
      ruleVersion: request.ruleVersion, content: text, createdAt: Date.now() }).onConflictDoNothing().run();
    return { text, source: 'ai' };
  } catch (error) {
    console.error('[Metaphysics] AI 解說失敗，改用模板', error);
    return { text: request.fallback, source: 'template' };
  }
}
```

- [ ] **Step 9: 套用本機 migration**

Run: `npm run db:migrate:local`
Expected: 顯示套用 `0031_metaphysics.sql` 成功。若本機還有尚未套用的 0030（工作區中未提交的股票代幣雷達），會一起套用，屬正常。

- [ ] **Step 10: 確認測試通過**

Run: `node --import tsx --test tests/metaphysics-store.integration.test.ts`
Expected: 4 個 test 全部 PASS。

- [ ] **Step 11: Commit**

```bash
git add drizzle/0031_metaphysics.sql app/db/metaphysicsSchema.ts app/services/metaphysics/birthInput.ts app/services/metaphysics/birthProfileStore.server.ts app/services/metaphysics/forecastStore.server.ts app/services/metaphysics/narrative.server.ts tests/metaphysics-store.integration.test.ts
git commit -m "feat: 玄學羅盤資料表、加密生辰、預測快照與 AI 解說快取"
```

---

### Task 7: 行情日線、AI 資料邊界、頁面資料組裝與路由

**Files:**
- Create: `app/services/metaphysics/marketBars.server.ts`
- Create: `app/services/metaphysics/narrativeFacts.ts`
- Create: `app/services/metaphysics/pageData.server.ts`
- Create: `app/routes/api.metaphysics.ts`
- Create（暫時版本）: `app/routes/metaphysics.tsx`
- Modify: `app/routes.ts`
- Test: `tests/metaphysics-page-data.test.ts`

**Interfaces:**
- Consumes: Task 1–6 的全部匯出；`fetchStockDailyHistory`、`fetchBinanceRange`、`type CryptoKlineSource`；`getUserId`（`app/utils/auth.ts`）
- Produces:
  - `marketBars.server.ts`：`fetchRecentDailyBars(market, now?): Promise<DailyBar[]>`、`fetchHistoryDailyBars(market, now?): Promise<DailyBar[]>`
  - `narrativeFacts.ts`：`interface NarrativeFacts { facts; fallback }`、`marketFacts(label, result)`、`baziProfileFacts(profile)`、`baziDailyFacts(today, year, daYun)`
  - `pageData.server.ts`：`CALENDAR_DAYS = 31`、`MARKETS`、`interface MarketCalendar { market; label; birthNote; timeAssumed; today; days: ZiweiDayResult[]; decadal: { name; range }|null; hitRate: { backtest: HitRateSummary; live: HitRateSummary } }`、`interface BaziView { profile; daYun: (DaYun & { luck: PillarLuck })|null; yearLuck; monthLuck; days: DailyLuck[] }`、`buildMarketDays(market, today)`、`buildBaziView(birth, taipeiToday)`、`loadMetaphysicsPage(args)`（回傳 `{ markets, bazi, birth, taipeiToday }`）、`metaphysicsAction(args)`（回傳 `{ ok: true; message }` 或 `{ ok: false; error }`）、`loadMetaphysicsApi(args)`

注意：
- Yahoo `range=max` 只回月線，回測一律用 `20y`（約 2006 年底起），規劃時已實測。
- 專案 tsconfig 未開 strict，布林判別式聯集無法收窄，`metaphysicsAction` 用 `'error' in parsed` 判斷。
- `/api/metaphysics?view=narrative` 一律只產生「今天」的解說，不接受任意日期參數，避免被拿來大量呼叫 AI。

- [ ] **Step 1: 寫失敗的測試**

`tests/metaphysics-page-data.test.ts`：

```ts
/** @file 頁面資料組裝與 AI 隱私邊界：31 天日曆、八字視圖、送給 AI 的內容不含出生日期與四柱。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBaziView, buildMarketDays, CALENDAR_DAYS } from '../app/services/metaphysics/pageData.server';
import { baziDailyFacts, baziProfileFacts, marketFacts } from '../app/services/metaphysics/narrativeFacts';
import type { BirthInput } from '../app/services/metaphysics/baziProfile';

const birth: BirthInput = { calendar: 'solar', year: 1990, month: 5, day: 20, isLeapMonth: false, hour: 23, minute: 30, hourUnknown: false, gender: 'male' };

test('市場日曆：從今天起連續 31 天，日期遞增', () => {
  const days = buildMarketDays('TW', '2026-11-09');
  assert.equal(days.length, CALENDAR_DAYS);
  assert.equal(days[0].tradeDate, '2026-11-09');
  assert.equal(days[30].tradeDate, '2026-12-09');
});

test('八字視圖：目前大運乙酉、今日流日平、31 天流日', () => {
  const view = buildBaziView(birth, '2026-11-09');
  assert.equal(view.daYun?.ganZhi, '乙酉');
  assert.equal(view.days.length, CALENDAR_DAYS);
  assert.equal(view.days[0].grade5, '平');
  assert.equal(view.yearLuck.grade5, '大凶');
});

test('送給 AI 的八字內容不含出生年份、四柱干支', () => {
  const view = buildBaziView(birth, '2026-11-09');
  const texts = [...baziProfileFacts(view.profile).facts, ...baziDailyFacts(view.days[0], view.yearLuck, view.daYun?.luck ?? null).facts].join('\n');
  assert.equal(texts.includes('1990'), false);
  for (const pillar of Object.values(view.profile.pillars)) {
    if (pillar) assert.equal(texts.includes(`${pillar.stem}${pillar.branch}`), false, `${pillar.stem}${pillar.branch}`);
  }
});

test('市場解說資料：最多 6 條觸發規則，模板含方向分數與強度', () => {
  const [today] = buildMarketDays('TW', '2026-11-09');
  const { facts, fallback } = marketFacts('台股', today);
  assert.ok(facts.length <= 9);
  assert.match(fallback, /方向分數 9、變盤強度 1/);
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `node --import tsx --test tests/metaphysics-page-data.test.ts`
Expected: FAIL，錯誤為找不到 `pageData.server` 模組。

- [ ] **Step 3: 實作 `app/services/metaphysics/marketBars.server.ts`**

```ts
/**
 * @file 抓三個市場的日線並換成「市場當地日期」的收盤序列，供回填與回測使用。
 * 外部 API 副作用：Yahoo（台股、美股指數）與 Bybit／Gate／Binance.US（BTC）公開端點，可能限流；失敗直接擲出，
 * 呼叫端標示「資料不足」，不以假資料替代。依回測資料鐵則，不使用 stockService.fetchStockData()。
 */
import { fetchBinanceRange, type CryptoKlineSource } from '../marketData/binanceHistory';
import { fetchStockDailyHistory } from '../marketData/stockDailyHistory';
import type { Candle } from '../strategy/types';
import { DAY_MS } from './calendarTime';
import { dailyBarsFromCandles, type DailyBar } from './hitRate';
import { MARKET_CHART_SPECS, type MetaMarket } from './marketChartSpecs';

/** BTC 日線最多續抓次數；每次 40 頁 × 1000 根，足以涵蓋 2017 年以來的資料。 */
const MAX_CRYPTO_ROUNDS = 10;

async function fetchCryptoDaily(startMs: number, endMs: number): Promise<Candle[]> {
  const candles: Candle[] = [];
  let cursor = startMs;
  let forcedSource: CryptoKlineSource | undefined;
  for (let round = 0; round < MAX_CRYPTO_ROUNDS; round++) {
    // 續抓時鎖定首次來源，避免同一序列混入不同交易所的收盤價。
    const page = await fetchBinanceRange(MARKET_CHART_SPECS.CRYPTO.quoteSymbol, '1d', cursor, endMs, 40, forcedSource ? { forcedSource } : {});
    forcedSource = page.source;
    candles.push(...page.candles);
    if (page.complete || page.nextCursor == null) break;
    cursor = page.nextCursor;
  }
  return candles;
}

/**
 * 抓最近約 90 天的日線（回填上線快照用）。
 * 股市 3 個月約 60 個交易日，足以滿足命中率判定需要的前 21 根。
 */
export async function fetchRecentDailyBars(market: MetaMarket, now = Date.now()): Promise<DailyBar[]> {
  const spec = MARKET_CHART_SPECS[market];
  const candles = market === 'CRYPTO'
    ? await fetchCryptoDaily(now - 90 * DAY_MS, now)
    : (await fetchStockDailyHistory(spec.quoteSymbol, '3mo')).candles;
  return dailyBarsFromCandles(candles, spec.timeZone);
}

/**
 * 抓長期日線（回測用）。股市用 Yahoo `20y`（實測 `max` 只回月線，不能用）；BTC 從 2017-01-01 起抓到資料來源最早可得的日期。
 */
export async function fetchHistoryDailyBars(market: MetaMarket, now = Date.now()): Promise<DailyBar[]> {
  const spec = MARKET_CHART_SPECS[market];
  const candles = market === 'CRYPTO'
    ? await fetchCryptoDaily(Date.UTC(2017, 0, 1), now)
    : (await fetchStockDailyHistory(spec.quoteSymbol, '20y')).candles;
  return dailyBarsFromCandles(candles, spec.timeZone);
}
```

- [ ] **Step 4: 實作 `app/services/metaphysics/narrativeFacts.ts`**

```ts
/**
 * @file 組出送給 AI 的「衍生標籤」與 AI 失敗時的模板文字（純函式）。
 * 隱私邊界：這裡只能輸出強弱、喜用分組、性格標籤、吉凶等級、四化觸發規則；
 * 不得輸出出生年月日時或四柱干支（四柱可反推出生日期）。測試會檢查這一點。
 */
import type { BaziProfile } from './baziProfile';
import type { DailyLuck, PillarLuck } from './baziLuck';
import type { ZiweiDayResult } from './types';

export interface NarrativeFacts { facts: string[]; fallback: string }

/** 觸發規則最多列出幾條：太多會稀釋 AI 解說重點，也讓模板文字過長。 */
const MAX_TRIGGERS = 6;

export function marketFacts(label: string, result: ZiweiDayResult): NarrativeFacts {
  const triggers = result.triggers.slice(0, MAX_TRIGGERS);
  return {
    facts: [`市場：${label}`, `方向分數：${result.directionScore}（-100～+100，正值偏多）`, `變盤強度：${result.turningStrength}（0–3）`, ...triggers],
    fallback: `${label}今日方向分數 ${result.directionScore}、變盤強度 ${result.turningStrength}。主要訊號：${triggers.slice(0, 3).join('；') || '無明顯四化衝擊'}。`,
  };
}

export function baziProfileFacts(profile: BaziProfile): NarrativeFacts {
  const favorable = profile.favorableGroups.join('、');
  return {
    facts: [`日主五行：${profile.dayElement}`, `日主強弱：${profile.strength}`, `喜用：${favorable}`,
      `忌：${profile.unfavorableGroups.join('、') || '無明顯忌神'}`, `投資性格：${profile.labels.join('、')}`],
    fallback: `你的日主屬${profile.dayElement}、${profile.strength}，喜${favorable}；投資性格偏${profile.labels.join('、')}。`,
  };
}

export function baziDailyFacts(today: DailyLuck, year: PillarLuck, daYun: PillarLuck | null): NarrativeFacts {
  const flags = today.flags.length > 0 ? `（${today.flags.join('、')}）` : '';
  return {
    facts: [`今日運勢：${today.grade5}${flags}`, `今年流年：${year.grade3}${year.flags.length ? `（${year.flags.join('、')}）` : ''}`,
      `目前大運：${daYun ? daYun.grade3 : '尚未起運'}`],
    fallback: `今日運勢${today.grade5}${flags}；今年流年${year.grade3}。`,
  };
}
```

- [ ] **Step 5: 實作 `app/services/metaphysics/pageData.server.ts`**

```ts
/**
 * @file /metaphysics 頁面與 /api/metaphysics 的資料組裝。
 * 副作用：寫入當日紫微快照、回填已收盤日期的實際漲跌（會呼叫外部行情 API）、讀寫加密生辰、呼叫 AI。
 * 任何快照或行情失敗都只記 log，不讓頁面失敗；結果不寫入任何交易或羅盤資料。
 */
import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from 'react-router';
import { getUserId } from '../../utils/auth';
import { buildBaziProfile, type BaziProfile, type BirthInput, type DaYun } from './baziProfile';
import { currentDaYun, dailyLuckRange, flowPillarsOf, gradePillar, type DailyLuck, type PillarLuck } from './baziLuck';
import { parseBirthForm } from './birthInput';
import { deleteBirthProfile, loadBirthProfile, saveBirthProfile, type D1Binding } from './birthProfileStore.server';
import { addDays, localDateOf } from './calendarTime';
import { applyOutcomes, listPendingLiveDates, loadScoredRows, recordLiveForecast, shouldSnapshot } from './forecastStore.server';
import { classifyOutcomes, summarizeHitRate, type HitRateSummary } from './hitRate';
import { fetchRecentDailyBars } from './marketBars.server';
import { MARKET_BIRTH_YEAR, MARKET_CHART_SPECS, type MetaMarket } from './marketChartSpecs';
import { MARKET_NATAL_CHARTS } from './marketNatalCharts.generated';
import { getNarrative, type NarrativeKind } from './narrative.server';
import { baziDailyFacts, baziProfileFacts, marketFacts } from './narrativeFacts';
import { BAZI_RULE_VERSION, ZIWEI_RULE_VERSION, type ZiweiDayResult } from './types';
import { currentDecadalPalace, evaluateZiweiDay } from './ziweiTiming';

type MetaEnv = Record<string, unknown> & { DB: D1Binding; MASTER_ENCRYPTION_KEY?: string };
const envOf = (context: unknown) => (context as { cloudflare: { env: MetaEnv } }).cloudflare.env;

/** 日曆顯示天數：今天＋未來 30 天。 */
export const CALENDAR_DAYS = 31;
export const MARKETS: MetaMarket[] = ['TW', 'CRYPTO', 'US'];
/** 個人運勢以台北日期為準（使用者在台灣）。 */
const PERSONAL_TIME_ZONE = 'Asia/Taipei';

export interface MarketCalendar {
  market: MetaMarket;
  label: string;
  birthNote: string;
  timeAssumed: boolean;
  today: string;
  days: ZiweiDayResult[];
  decadal: { name: string; range: [number, number] } | null;
  hitRate: { backtest: HitRateSummary; live: HitRateSummary };
}

export interface BaziView {
  profile: BaziProfile;
  daYun: (DaYun & { luck: PillarLuck }) | null;
  yearLuck: PillarLuck;
  monthLuck: PillarLuck;
  days: DailyLuck[];
}

export function buildMarketDays(market: MetaMarket, today: string): ZiweiDayResult[] {
  return Array.from({ length: CALENDAR_DAYS }, (_, i) => evaluateZiweiDay(market, addDays(today, i)));
}

export function buildBaziView(birth: BirthInput, taipeiToday: string): BaziView {
  const profile = buildBaziProfile(birth);
  const flow = flowPillarsOf(taipeiToday);
  const yun = currentDaYun(profile, Number(taipeiToday.slice(0, 4)));
  return {
    profile,
    daYun: yun ? { ...yun, luck: gradePillar(profile, { stem: yun.stem, branch: yun.branch }) } : null,
    yearLuck: gradePillar(profile, flow.year, profile.pillars.day.branch),
    monthLuck: gradePillar(profile, flow.month),
    days: dailyLuckRange(profile, taipeiToday, CALENDAR_DAYS),
  };
}

/** 寫入今天的上線快照，並回填已收盤但尚未回填的日期；失敗只記 log。 */
async function syncLiveSnapshots(db: D1Binding, market: MetaMarket, today: ZiweiDayResult): Promise<void> {
  try {
    if (shouldSnapshot(market, today.tradeDate)) await recordLiveForecast(db, today);
    const pending = await listPendingLiveDates(db, market, today.tradeDate);
    if (pending.length === 0) return;
    const outcomes = classifyOutcomes(await fetchRecentDailyBars(market)).filter((o) => pending.includes(o.date));
    await applyOutcomes(db, market, outcomes);
  } catch (error) {
    console.error(`[Metaphysics] ${market} 快照或回填失敗`, error);
  }
}

async function loadMarketCalendar(db: D1Binding, market: MetaMarket, now: number): Promise<MarketCalendar> {
  const spec = MARKET_CHART_SPECS[market];
  const today = localDateOf(now, spec.timeZone);
  const days = buildMarketDays(market, today);
  await syncLiveSnapshots(db, market, days[0]);
  const [backtestRows, liveRows] = await Promise.all([loadScoredRows(db, market, 'backtest'), loadScoredRows(db, market, 'live')]);
  const decadal = currentDecadalPalace(MARKET_NATAL_CHARTS[market], MARKET_BIRTH_YEAR[market], Number(today.slice(0, 4)));
  return { market, label: spec.label, birthNote: spec.birthNote, timeAssumed: spec.timeAssumed, today, days,
    decadal: decadal ? { name: decadal.name, range: decadal.decadalRange } : null,
    hitRate: { backtest: summarizeHitRate(backtestRows), live: summarizeHitRate(liveRows) } };
}

export async function loadMetaphysicsPage({ request, context }: LoaderFunctionArgs) {
  const env = envOf(context);
  const userId = await getUserId(request, env);
  if (!userId) throw redirect('/login');
  const now = Date.now();
  const taipeiToday = localDateOf(now, PERSONAL_TIME_ZONE);
  const markets = await Promise.all(MARKETS.map((market) => loadMarketCalendar(env.DB, market, now)));
  const birth = await loadBirthProfile(env.DB, env.MASTER_ENCRYPTION_KEY, userId);
  let bazi: BaziView | null = null;
  try { bazi = birth ? buildBaziView(birth, taipeiToday) : null; }
  catch (error) { console.error('[Metaphysics] 八字排盤失敗', error); }
  return { markets, bazi, birth, taipeiToday };
}

export async function metaphysicsAction({ request, context }: ActionFunctionArgs) {
  const env = envOf(context);
  const userId = await getUserId(request, env);
  if (!userId) throw redirect('/login');
  const form = await request.formData();
  const intent = form.get('intent');
  if (intent === 'deleteBirth') {
    await deleteBirthProfile(env.DB, userId);
    return { ok: true as const, message: '已刪除生辰資料與個人解說快取' };
  }
  if (intent !== 'saveBirth') return { ok: false as const, error: '未知的操作' };
  const parsed = parseBirthForm(form, new Date().getUTCFullYear());
  // 專案 tsconfig 未開 strict，布林判別式無法收窄型別，改用 'in' 判斷。
  if ('error' in parsed) return { ok: false as const, error: parsed.error };
  try {
    await saveBirthProfile(env.DB, env.MASTER_ENCRYPTION_KEY, userId, parsed.value);
    return { ok: true as const, message: '生辰已加密保存' };
  } catch (error) {
    console.error('[Metaphysics] 保存生辰失敗', error);
    return { ok: false as const, error: '保存失敗，請稍後再試' };
  }
}

const NARRATIVE_KINDS: NarrativeKind[] = ['market_TW', 'market_CRYPTO', 'market_US', 'bazi_profile', 'bazi_daily'];

/** GET /api/metaphysics?view=today｜narrative&kind=…。只回傳登入者自己的資料。 */
export async function loadMetaphysicsApi({ request, context }: LoaderFunctionArgs) {
  const env = envOf(context);
  const userId = await getUserId(request, env);
  if (!userId) return Response.json({ error: '請先登入' }, { status: 401 });
  const url = new URL(request.url);
  const now = Date.now();
  const taipeiToday = localDateOf(now, PERSONAL_TIME_ZONE);
  if (url.searchParams.get('view') === 'today') {
    const markets = MARKETS.map((market) => {
      const result = evaluateZiweiDay(market, localDateOf(now, MARKET_CHART_SPECS[market].timeZone));
      return { market, label: MARKET_CHART_SPECS[market].label, turningStrength: result.turningStrength, directionScore: result.directionScore };
    });
    const birth = await loadBirthProfile(env.DB, env.MASTER_ENCRYPTION_KEY, userId);
    const personal = birth ? buildBaziView(birth, taipeiToday).days[0] : null;
    return Response.json({ markets, personal: personal ? { grade: personal.grade5, flags: personal.flags } : null });
  }
  const kind = url.searchParams.get('kind') as NarrativeKind;
  if (!NARRATIVE_KINDS.includes(kind)) return Response.json({ error: '不支援的解說種類' }, { status: 400 });
  if (kind.startsWith('market_')) {
    const market = kind.slice('market_'.length) as MetaMarket;
    const spec = MARKET_CHART_SPECS[market];
    const result = evaluateZiweiDay(market, localDateOf(now, spec.timeZone));
    const { facts, fallback } = marketFacts(spec.label, result);
    return Response.json(await getNarrative({ db: env.DB, env, userId: 0, kind, cacheDate: result.tradeDate,
      ruleVersion: ZIWEI_RULE_VERSION, facts, fallback }));
  }
  const birth = await loadBirthProfile(env.DB, env.MASTER_ENCRYPTION_KEY, userId);
  if (!birth) return Response.json({ error: '尚未填寫生辰' }, { status: 404 });
  const view = buildBaziView(birth, taipeiToday);
  const { facts, fallback } = kind === 'bazi_profile' ? baziProfileFacts(view.profile)
    : baziDailyFacts(view.days[0], view.yearLuck, view.daYun?.luck ?? null);
  return Response.json(await getNarrative({ db: env.DB, env, userId, kind, cacheDate: taipeiToday,
    ruleVersion: BAZI_RULE_VERSION, facts, fallback }));
}
```

- [ ] **Step 6: 註冊路由並建立 API 與暫時頁面**

在 `app/routes.ts` 的 `route("tradingview-signals", "routes/tradingview-signals.tsx"),` 之後加兩行：

```ts
  route("metaphysics", "routes/metaphysics.tsx"),
  route("api/metaphysics", "routes/api.metaphysics.ts"),
```

建立 `app/routes/api.metaphysics.ts`：

```ts
/** @file GET /api/metaphysics?view=today｜narrative&kind=…：首頁小卡與 AI 解說用；只回傳登入者自己的資料。 */
import { loadMetaphysicsApi } from '../services/metaphysics/pageData.server';

export const loader = loadMetaphysicsApi;
```

`app/routes/metaphysics.tsx` 在 Task 9 才建立；這一步先暫時建立只匯出 loader／action 的版本，讓 typegen 與 build 不會因路由缺檔而失敗：

```ts
/** @file 玄學羅盤頁面（暫時版本，Task 9 會換成完整頁面）。 */
import { loadMetaphysicsPage, metaphysicsAction } from '../services/metaphysics/pageData.server';

export const loader = loadMetaphysicsPage;
export const action = metaphysicsAction;

export default function MetaphysicsPage() {
  return null;
}
```

- [ ] **Step 7: 確認測試通過**

Run: `node --import tsx --test tests/metaphysics-page-data.test.ts`
Expected: 4 個 test 全部 PASS。

- [ ] **Step 8: Commit**

```bash
git add app/services/metaphysics/marketBars.server.ts app/services/metaphysics/narrativeFacts.ts app/services/metaphysics/pageData.server.ts app/routes/api.metaphysics.ts app/routes/metaphysics.tsx app/routes.ts tests/metaphysics-page-data.test.ts
git commit -m "feat: 玄學羅盤頁面資料組裝、AI 隱私邊界與 API 路由"
```

---

### Task 8: 紫微回測腳本

**Files:**
- Create: `scripts/metaphysics/backtest-ziwei-timing.ts`

**Interfaces:**
- Consumes: `classifyOutcomes`、`summarizeHitRate`、`wilson`、`RateStat`、`fetchHistoryDailyBars`、`MARKET_CHART_SPECS`、`ZIWEI_RULE_VERSION`、`evaluateZiweiDay`
- Produces: `output/metaphysics/ziwei-backtest.md`、`output/metaphysics/ziwei-backtest.sql`（`output/` 不進版控）

- [ ] **Step 1: 建立 `scripts/metaphysics/backtest-ziwei-timing.ts`**

```ts
/**
 * @file 紫微變盤規則回測：用歷史日線逐日比對預測與實際，輸出 Markdown 報告與可匯入 D1 的 SQL。
 * 外部 API 副作用：抓 Yahoo（^TWII、^GSPC，range=20y）與 BTC 日線；本腳本不連 D1、不寫任何資料庫。
 * 執行：node --import tsx scripts/metaphysics/backtest-ziwei-timing.ts
 * 匯入：npx wrangler d1 execute crypto-analytics-db --local --file=output/metaphysics/ziwei-backtest.sql（正式環境改 --remote）
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { classifyOutcomes, summarizeHitRate, wilson, type RateStat } from '../../app/services/metaphysics/hitRate';
import { fetchHistoryDailyBars } from '../../app/services/metaphysics/marketBars.server';
import { MARKET_CHART_SPECS, type MetaMarket } from '../../app/services/metaphysics/marketChartSpecs';
import { ZIWEI_RULE_VERSION } from '../../app/services/metaphysics/types';
import { evaluateZiweiDay } from '../../app/services/metaphysics/ziweiTiming';

const OUTPUT_DIR = 'output/metaphysics';
/** 每條 INSERT 最多幾列：D1 單一語句有大小限制，分批較穩。 */
const ROWS_PER_INSERT = 200;
const MARKETS: MetaMarket[] = ['TW', 'CRYPTO', 'US'];

interface BacktestRow { market: MetaMarket; date: string; directionScore: number; turningStrength: number; triggers: string[]; changePct: number; isTurning: boolean }

const pct = (stat: RateStat) => (stat.rate == null ? '—' : `${(stat.rate * 100).toFixed(1)}%（${stat.hits}/${stat.total}，95% 區間 ${(stat.low! * 100).toFixed(1)}–${(stat.high! * 100).toFixed(1)}%）`);
const sqlText = (value: string) => `'${value.replace(/'/g, "''")}'`;

async function backtestMarket(market: MetaMarket): Promise<BacktestRow[]> {
  const outcomes = classifyOutcomes(await fetchHistoryDailyBars(market));
  return outcomes.map((outcome) => {
    const result = evaluateZiweiDay(market, outcome.date);
    return { market, date: outcome.date, directionScore: result.directionScore, turningStrength: result.turningStrength,
      triggers: result.triggers, changePct: outcome.changePct, isTurning: outcome.isTurning };
  });
}

function reportSection(market: MetaMarket, rows: BacktestRow[]): string {
  const scored = rows.map((r) => ({ turningStrength: r.turningStrength, directionScore: r.directionScore, actualChangePct: r.changePct, isTurningActual: r.isTurning }));
  const summary = summarizeHitRate(scored);
  const byStrength = [0, 1, 2, 3].map((level) => {
    const subset = rows.filter((r) => r.turningStrength === level);
    return `| ${level} | ${subset.length} | ${pct(wilson(subset.filter((r) => r.isTurning).length, subset.length))} |`;
  });
  return [
    `## ${MARKET_CHART_SPECS[market].label}（${rows[0]?.date ?? '—'} ～ ${rows.at(-1)?.date ?? '—'}，${rows.length} 個交易日）`, '',
    `- 變盤命中率（強度 ≥ 2）：${pct(summary.turning)}`,
    `- 基準（任意一天實際變盤）：${pct(summary.turningBaseline)}`,
    `- 變盤是否與隨機有差異：${summary.turningDistinguishable ? '是（區間不重疊）' : '否（區間重疊）'}`,
    `- 方向命中率（|分數| ≥ 30）：${pct(summary.direction)}`,
    `- 基準（一直猜漲）：${pct(summary.directionBaseline)}`,
    `- 方向是否與隨機有差異：${summary.directionDistinguishable ? '是（區間不重疊）' : '否（區間重疊）'}`, '',
    '| 強度 | 天數 | 實際變盤比例 |', '|---|---|---|', ...byStrength, '',
  ].join('\n');
}

function toSql(rows: BacktestRow[], createdAt: number): string {
  const lines = [`DELETE FROM metaphysics_market_forecasts WHERE source = 'backtest' AND rule_version = ${sqlText(ZIWEI_RULE_VERSION)};`];
  for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
    const values = rows.slice(i, i + ROWS_PER_INSERT).map((r) => `(${sqlText(r.market)}, ${sqlText(r.date)}, ${sqlText(ZIWEI_RULE_VERSION)}, 'backtest', ${r.directionScore}, ${r.turningStrength}, ${sqlText(JSON.stringify(r.triggers))}, ${r.changePct}, ${r.isTurning ? 1 : 0}, ${createdAt})`);
    lines.push(`INSERT INTO metaphysics_market_forecasts (market, trade_date, rule_version, source, direction_score, turning_strength, triggers_json, actual_change_pct, is_turning_actual, created_at) VALUES\n${values.join(',\n')};`);
  }
  return lines.join('\n');
}

async function main() {
  const createdAt = Date.now();
  const allRows: BacktestRow[] = [];
  const sections: string[] = [];
  for (const market of MARKETS) {
    const rows = await backtestMarket(market);
    allRows.push(...rows);
    sections.push(reportSection(market, rows));
    console.log(`${market}：${rows.length} 個交易日`);
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const header = `# 紫微變盤回測報告（${ZIWEI_RULE_VERSION}）\n\n產生時間：${new Date(createdAt).toISOString()}。玄學參考，非量化訊號；規則在看行情前已固定，命中率需與基準並列判讀。\n\n`;
  writeFileSync(`${OUTPUT_DIR}/ziwei-backtest.md`, header + sections.join('\n'));
  writeFileSync(`${OUTPUT_DIR}/ziwei-backtest.sql`, toSql(allRows, createdAt));
  console.log(`已輸出 ${OUTPUT_DIR}/ziwei-backtest.md 與 .sql`);
}

main().catch((error) => { console.error(error); process.exit(1); });
```

- [ ] **Step 2: 執行回測**

Run: `node --import tsx scripts/metaphysics/backtest-ziwei-timing.ts`（會呼叫 Yahoo 與加密貨幣交易所公開 API，約 1 分鐘）
Expected: 印出三行「TW／CRYPTO／US：N 個交易日」（規劃時實測約 4866／1932／5010）與「已輸出 …」。報告的每個市場都有變盤命中率、基準、方向命中率、基準與「是否與隨機有差異」。

規劃時（2026-11-09）實測結果：三個市場的變盤命中率與方向命中率**都落在基準的 95% 區間內，與隨機無明顯差異**（例如台股強度 ≥ 2 的日子實際變盤 35.0%，任意一天 35.1%）。**不得**為了改善這個結果回頭調整規則；若要改規則，必須升版 `ZIWEI_RULE_VERSION` 並在報告中註明是看過回測後才調整。

- [ ] **Step 3: 匯入本機 D1**

Run: `npx wrangler d1 execute crypto-analytics-db --local --file=output/metaphysics/ziwei-backtest.sql`
Expected: 執行成功；`npx wrangler d1 execute crypto-analytics-db --local --command "SELECT market, COUNT(*) FROM metaphysics_market_forecasts WHERE source = 'backtest' GROUP BY market"` 顯示三個市場的筆數與上一步一致。

- [ ] **Step 4: Commit**

```bash
git add scripts/metaphysics/backtest-ziwei-timing.ts
git commit -m "feat: 玄學羅盤紫微變盤回測腳本"
```

---

### Task 9: 頁面、元件、選單與首頁小卡

**Files:**
- Create: `app/features/metaphysics/MetaphysicsDisclaimer.tsx`
- Create: `app/features/metaphysics/NarrativeBox.tsx`
- Create: `app/features/metaphysics/dayStyles.ts`
- Create: `app/features/metaphysics/MarketTimingCalendar.tsx`
- Create: `app/features/metaphysics/BirthProfileForm.tsx`
- Create: `app/features/metaphysics/MyBaziPanel.tsx`
- Create: `app/features/metaphysics/HitRatePanel.tsx`
- Create: `app/features/home/components/MetaphysicsMiniCard.tsx`
- Modify: `app/routes/metaphysics.tsx`（換成完整頁面）
- Modify: `app/components/AppLayout.tsx`、`app/routes/home.tsx`、`app/routes/settings.tsx`

**Interfaces:**
- Consumes: `MarketCalendar`、`BaziView`、`loadMetaphysicsPage`、`metaphysicsAction`（pageData）；`BirthInput`；`combinedHint`；`RateStat`；`/api/metaphysics?view=today` 回傳 `{ markets: [{ market, label, turningStrength, directionScore }], personal: { grade, flags }|null }`；`/api/metaphysics?view=narrative&kind=…` 回傳 `{ text, source }`
- Produces: 頁面 `/metaphysics`、首頁小卡

客戶端元件只能 `import type` 從 `*.server.ts` 取型別，不得以值匯入 server 模組。顏色沿用漲跌羅盤慣例：emerald 偏多、rose 偏空。

- [ ] **Step 1: 建立 `app/features/metaphysics/MetaphysicsDisclaimer.tsx`**

```tsx
/** @component 玄學羅盤免責聲明；頁首與首頁小卡共用，文案固定不可省略。 */
export function MetaphysicsDisclaimer({ compact = false }: { compact?: boolean }) {
  if (compact) return <p className="text-[11px] opacity-60">玄學參考・非量化訊號・不構成投資建議</p>;
  return (
    <p role="note" className="rounded border border-amber-500/40 bg-amber-950/20 p-3 text-sm text-amber-200">
      玄學參考，非量化訊號，不構成投資建議。結果不會影響漲跌羅盤、選股、下單與風控；命中率分頁可查看歷史回測是否優於隨機。
    </p>
  );
}
```

- [ ] **Step 2: 建立 `app/features/metaphysics/NarrativeBox.tsx`**

```tsx
/**
 * @component AI 解說框：向 /api/metaphysics 取當日解說，與頁面主體分開載入，避免 AI 慢時拖住整頁。
 * 只取「今天」的解說；伺服器會快取，同一天重複開啟不會重複呼叫 AI。
 */
import { useEffect, useState } from 'react';

type NarrativeState = { status: 'loading' } | { status: 'done'; text: string; source: string } | { status: 'error'; message: string };

const SOURCE_LABEL: Record<string, string> = { ai: 'AI 解說', cache: 'AI 解說', template: '規則摘要（AI 暫時無法使用）' };

export function NarrativeBox({ kind }: { kind: string }) {
  const [state, setState] = useState<NarrativeState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetch(`/api/metaphysics?view=narrative&kind=${encodeURIComponent(kind)}`)
      .then(async (response) => {
        const body = await response.json() as { text?: string; source?: string; error?: string };
        if (cancelled) return;
        if (!response.ok || !body.text) setState({ status: 'error', message: body.error ?? '解說載入失敗' });
        else setState({ status: 'done', text: body.text, source: body.source ?? 'template' });
      })
      .catch(() => { if (!cancelled) setState({ status: 'error', message: '解說載入失敗' }); });
    return () => { cancelled = true; };
  }, [kind]);
  if (state.status === 'loading') return <p className="text-sm opacity-60">解說產生中…</p>;
  if (state.status === 'error') return <p className="text-sm text-rose-300">{state.message}</p>;
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      <p>{state.text}</p>
      <p className="text-[11px] opacity-50">{SOURCE_LABEL[state.source] ?? state.source}</p>
    </div>
  );
}
```

- [ ] **Step 3: 建立 `app/features/metaphysics/dayStyles.ts`**

```ts
/** @file 玄學羅盤日曆的共用樣式工具；顏色沿用漲跌羅盤慣例（emerald 偏多、rose 偏空）。 */

/** 方向分數 |分數| ≥ 30 才算表態，與命中率統計門檻一致。 */
const DIRECTION_THRESHOLD = 30;

export function directionTone(score: number): { label: string; className: string } {
  if (score >= DIRECTION_THRESHOLD) return { label: '偏多', className: 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300' };
  if (score <= -DIRECTION_THRESHOLD) return { label: '偏空', className: 'border-rose-500/40 bg-rose-950/20 text-rose-300' };
  return { label: '中性', className: 'border-current/15' };
}

export const strengthStars = (strength: number) => '★'.repeat(strength) + '☆'.repeat(3 - strength);

/** 'YYYY-MM-DD' → 'M/D 週X'（日期字串本身就是當地日期，直接用 UTC 解讀避免瀏覽器時區位移）。 */
export function shortDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()} 週${'日一二三四五六'[date.getUTCDay()]}`;
}

export const GRADE_CLASS: Record<string, string> = {
  大吉: 'text-emerald-300', 吉: 'text-emerald-200', 平: 'opacity-70', 凶: 'text-rose-200', 大凶: 'text-rose-300',
};
```

- [ ] **Step 4: 建立 `app/features/metaphysics/MarketTimingCalendar.tsx`**

```tsx
/** @component 市場變盤日曆：切換台股／BTC／美股，列出 31 天方向與變盤強度，點日期展開四化觸發與當日 AI 解說。 */
import { useState } from 'react';
import type { MarketCalendar } from '../../services/metaphysics/pageData.server';
import { NarrativeBox } from './NarrativeBox';
import { directionTone, shortDate, strengthStars } from './dayStyles';

export function MarketTimingCalendar({ markets }: { markets: MarketCalendar[] }) {
  const [marketIndex, setMarketIndex] = useState(0);
  const [dayIndex, setDayIndex] = useState(0);
  const calendar = markets[marketIndex];
  const day = calendar.days[dayIndex];
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {markets.map((m, i) => (
          <button key={m.market} onClick={() => { setMarketIndex(i); setDayIndex(0); }}
            className={`rounded border px-3 py-1 text-sm ${i === marketIndex ? 'border-current' : 'border-current/20 opacity-70'}`}>{m.label}</button>
        ))}
      </div>
      <p className="text-xs opacity-65">
        本命盤：{calendar.birthNote}{calendar.timeAssumed && '（時辰為假設）'}　·　目前大限：
        {calendar.decadal ? `${calendar.decadal.name}（虛歲 ${calendar.decadal.range[0]}–${calendar.decadal.range[1]}）` : '超出大限範圍（市場盤年齡逾 120 歲）'}
      </p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
        {calendar.days.map((d, i) => {
          const tone = directionTone(d.directionScore);
          return (
            <button key={d.tradeDate} onClick={() => setDayIndex(i)}
              className={`rounded border p-2 text-left text-xs ${tone.className} ${i === dayIndex ? 'ring-1 ring-current' : ''}`}>
              <div className="font-semibold">{shortDate(d.tradeDate)}</div>
              <div>{tone.label} {d.directionScore > 0 ? `+${d.directionScore}` : d.directionScore}</div>
              <div aria-label={`變盤強度 ${d.turningStrength}`}>{strengthStars(d.turningStrength)}</div>
            </button>
          );
        })}
      </div>
      <article className="space-y-3 rounded-xl border border-current/15 p-4">
        <h3 className="font-bold">{calendar.label} {shortDate(day.tradeDate)}：方向 {day.directionScore}、變盤強度 {day.turningStrength}</h3>
        <p className="text-xs opacity-65">流年 {day.stems.流年}・流月 {day.stems.流月}・流日 {day.stems.流日}（{day.ruleVersion}）</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">{day.triggers.map((t) => <li key={t}>{t}</li>)}</ul>
        {/* AI 解說只提供「今天」，避免為未來 30 天逐日呼叫 AI。 */}
        {dayIndex === 0 && <NarrativeBox kind={`market_${calendar.market}`} />}
      </article>
    </section>
  );
}
```

- [ ] **Step 5: 建立 `app/features/metaphysics/BirthProfileForm.tsx`**

```tsx
/** @component 生辰表單：國曆／農曆、時辰不明、性別；送出到 /metaphysics action 加密保存，亦可刪除。 */
import { Form, useNavigation } from 'react-router';
import type { BirthInput } from '../../services/metaphysics/baziProfile';

const field = 'w-full rounded border border-current/20 bg-transparent px-2 py-1';

export function BirthProfileForm({ birth }: { birth: BirthInput | null }) {
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';
  return (
    <div className="space-y-3">
      <Form method="post" className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="intent" value="saveBirth" />
        <label className="text-sm">曆法
          <select name="calendar" defaultValue={birth?.calendar ?? 'solar'} className={field}>
            <option value="solar">國曆</option><option value="lunar">農曆</option>
          </select>
        </label>
        <label className="text-sm">性別（決定大運順逆）
          <select name="gender" defaultValue={birth?.gender ?? 'male'} className={field}>
            <option value="male">男</option><option value="female">女</option>
          </select>
        </label>
        <div className="grid grid-cols-3 gap-2 text-sm sm:col-span-2">
          <label>年<input name="year" inputMode="numeric" defaultValue={birth?.year ?? ''} required className={field} /></label>
          <label>月<input name="month" inputMode="numeric" defaultValue={birth?.month ?? ''} required className={field} /></label>
          <label>日<input name="day" inputMode="numeric" defaultValue={birth?.day ?? ''} required className={field} /></label>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isLeapMonth" defaultChecked={birth?.isLeapMonth ?? false} />農曆閏月</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="hourUnknown" defaultChecked={birth?.hourUnknown ?? false} />時辰不明</label>
        <div className="grid grid-cols-2 gap-2 text-sm sm:col-span-2">
          <label>時（0–23）<input name="hour" inputMode="numeric" defaultValue={birth && !birth.hourUnknown ? birth.hour : ''} className={field} /></label>
          <label>分<input name="minute" inputMode="numeric" defaultValue={birth && !birth.hourUnknown ? birth.minute : ''} className={field} /></label>
        </div>
        <p className="text-xs opacity-65 sm:col-span-2">
          生辰加密保存，只用於你自己的命盤。子時以 23:00 換日；1937–1979 年間台灣時鐘快一小時的時段會自動修正。
        </p>
        <button disabled={busy} className="rounded border border-current/40 px-4 py-2 text-sm sm:col-span-2">{busy ? '保存中…' : '保存生辰'}</button>
      </Form>
      {birth && (
        <Form method="post" onSubmit={(e) => { if (!confirm('確定刪除生辰資料？個人解說快取也會一併刪除。')) e.preventDefault(); }}>
          <input type="hidden" name="intent" value="deleteBirth" />
          <button disabled={busy} className="text-xs text-rose-300 underline">刪除我的生辰資料</button>
        </Form>
      )}
    </div>
  );
}
```

- [ ] **Step 6: 建立 `app/features/metaphysics/MyBaziPanel.tsx`**

```tsx
/** @component 我的八字：命局與投資性格、大運流年、31 天流日吉凶（疊加所選市場的變盤強度與提示）。 */
import { useState } from 'react';
import type { BirthInput } from '../../services/metaphysics/baziProfile';
import { combinedHint } from '../../services/metaphysics/combinedHint';
import type { BaziView, MarketCalendar } from '../../services/metaphysics/pageData.server';
import { BirthProfileForm } from './BirthProfileForm';
import { NarrativeBox } from './NarrativeBox';
import { GRADE_CLASS, shortDate, strengthStars } from './dayStyles';

interface Props { bazi: BaziView | null; birth: BirthInput | null; markets: MarketCalendar[] }

export function MyBaziPanel({ bazi, birth, markets }: Props) {
  const [marketIndex, setMarketIndex] = useState(0);
  if (!bazi) {
    return (
      <section className="space-y-4 rounded-xl border border-current/15 p-5">
        <h2 className="text-lg font-bold">填寫生辰，查看你的八字運勢</h2>
        {birth && <p className="text-sm text-rose-300">已保存的生辰無法排盤，請重新填寫。</p>}
        <BirthProfileForm birth={birth} />
      </section>
    );
  }
  const { profile } = bazi;
  const market = markets[marketIndex];
  const strengthByDate = new Map(market.days.map((d) => [d.tradeDate, d.turningStrength]));
  const pillars = [['年', profile.pillars.year], ['月', profile.pillars.month], ['日', profile.pillars.day], ['時', profile.pillars.hour]] as const;
  return (
    <section className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <article className="space-y-2 rounded-xl border border-current/15 p-4">
          <h3 className="font-bold">命局與投資性格</h3>
          <p className="text-lg tracking-widest">{pillars.map(([name, p]) => `${name}:${p ? p.stem + p.branch : '—'}`).join('　')}</p>
          <p className="text-sm">日主 {profile.dayElement}・{profile.strength}（{profile.strengthScore} 分）・喜 {profile.favorableGroups.join('、')}{profile.unfavorableGroups.length > 0 && `・忌 ${profile.unfavorableGroups.join('、')}`}</p>
          <p className="text-sm">性格：{profile.labels.join('、')}</p>
          {profile.hourUnknown && <p className="text-xs text-amber-200">時辰不明，只排三柱；補填時辰可得完整分析。</p>}
          {profile.dstCorrected && <p className="text-xs opacity-65">已依台灣舊時制把出生時間減 1 小時。</p>}
          <p className="text-xs opacity-50">喜用神為扶抑法簡化版，不處理從格與調候。</p>
          <NarrativeBox kind="bazi_profile" />
        </article>
        <article className="space-y-2 rounded-xl border border-current/15 p-4">
          <h3 className="font-bold">大運與流年</h3>
          <p className="text-sm">目前大運：{bazi.daYun ? `${bazi.daYun.ganZhi}（${bazi.daYun.startYear}–${bazi.daYun.endYear}）・${bazi.daYun.luck.grade3}` : '尚未起運'}</p>
          <p className="text-sm">今年流年：{bazi.yearLuck.pillar.stem}{bazi.yearLuck.pillar.branch}・{bazi.yearLuck.grade5}{bazi.yearLuck.flags.length > 0 && `（${bazi.yearLuck.flags.join('、')}）`}</p>
          <p className="text-sm">本月流月：{bazi.monthLuck.pillar.stem}{bazi.monthLuck.pillar.branch}・{bazi.monthLuck.grade5}</p>
          <NarrativeBox kind="bazi_daily" />
        </article>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">疊加市場：
        {markets.map((m, i) => (
          <button key={m.market} onClick={() => setMarketIndex(i)}
            className={`rounded border px-2 py-0.5 ${i === marketIndex ? 'border-current' : 'border-current/20 opacity-70'}`}>{m.label}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {bazi.days.map((d) => {
          // 個人以台北日期、市場以當地日期；同一天字串比對即可（美股日期可能落後一天，查不到時強度視為 0）。
          const strength = strengthByDate.get(d.date) ?? 0;
          const hint = combinedHint(strength, d.grade5);
          return (
            <div key={d.date} className="rounded border border-current/15 p-2 text-xs">
              <div className="font-semibold">{shortDate(d.date)}</div>
              <div className={GRADE_CLASS[d.grade5]}>{d.grade5}{d.flags.length > 0 && ` ${d.flags.join('/')}`}</div>
              <div>{market.label} {strengthStars(strength)}</div>
              <div className="opacity-80">{hint.tone}</div>
            </div>
          );
        })}
      </div>
      <details className="rounded-xl border border-current/15 p-4">
        <summary className="cursor-pointer text-sm">修改或刪除生辰</summary>
        <div className="mt-3"><BirthProfileForm birth={birth} /></div>
      </details>
    </section>
  );
}
```

- [ ] **Step 7: 建立 `app/features/metaphysics/HitRatePanel.tsx`**

```tsx
/** @component 命中率：各市場回測與上線後快照的變盤／方向命中率，並列基準機率與 95% 區間。 */
import type { RateStat } from '../../services/metaphysics/hitRate';
import type { MarketCalendar } from '../../services/metaphysics/pageData.server';

const formatRate = (stat: RateStat) => (stat.rate == null ? '資料不足'
  : `${(stat.rate * 100).toFixed(1)}%（${stat.hits}/${stat.total}，${(stat.low! * 100).toFixed(1)}–${(stat.high! * 100).toFixed(1)}%）`);

export function HitRatePanel({ markets }: { markets: MarketCalendar[] }) {
  return (
    <section className="space-y-4">
      <p className="text-sm opacity-75">
        「變盤」指當日漲跌幅 ≥ 前 20 日平均的 1.5 倍，或連三日同向後反轉；變盤命中率只看強度 ≥ 2 的日子，方向命中率只看 |分數| ≥ 30 的日子。
        玄學命中率的 95% 區間必須與基準不重疊，才算與隨機有差異。
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead><tr className="border-b border-current/20">
            <th className="py-2">市場</th><th>來源</th><th>變盤命中率</th><th>變盤基準</th><th>方向命中率</th><th>方向基準（一直猜漲）</th><th>判讀</th>
          </tr></thead>
          <tbody>
            {markets.flatMap((m) => (['backtest', 'live'] as const).map((source) => {
              const s = m.hitRate[source];
              const verdict = s.turning.total === 0 ? '資料不足'
                : s.turningDistinguishable || s.directionDistinguishable ? '與隨機有差異' : '與隨機無明顯差異';
              return (
                <tr key={`${m.market}-${source}`} className="border-b border-current/10">
                  <td className="py-2">{m.label}</td><td>{source === 'backtest' ? '歷史回測' : '上線後快照'}</td>
                  <td>{formatRate(s.turning)}</td><td>{formatRate(s.turningBaseline)}</td>
                  <td>{formatRate(s.direction)}</td><td>{formatRate(s.directionBaseline)}</td><td>{verdict}</td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>
      <p className="text-xs opacity-60">規則版本 ziwei-v1；回測資料由 scripts/metaphysics/backtest-ziwei-timing.ts 產生後匯入。</p>
    </section>
  );
}
```

- [ ] **Step 8: 把 `app/routes/metaphysics.tsx` 換成完整頁面**

```tsx
/** @file 玄學羅盤頁面：紫微市場變盤日曆、我的八字、命中率。玄學參考，不影響任何量化訊號與交易。 */
import { useState } from 'react';
import { useActionData, useLoaderData } from 'react-router';
import { AppLayout } from '../components/AppLayout';
import { HitRatePanel } from '../features/metaphysics/HitRatePanel';
import { MarketTimingCalendar } from '../features/metaphysics/MarketTimingCalendar';
import { MetaphysicsDisclaimer } from '../features/metaphysics/MetaphysicsDisclaimer';
import { MyBaziPanel } from '../features/metaphysics/MyBaziPanel';
import { loadMetaphysicsPage, metaphysicsAction } from '../services/metaphysics/pageData.server';

export const loader = loadMetaphysicsPage;
export const action = metaphysicsAction;

const TABS = ['市場變盤日曆', '我的八字', '命中率'] as const;

export default function MetaphysicsPage() {
  const { markets, bazi, birth, taipeiToday } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  // 剛送出生辰表單時直接停在「我的八字」，讓使用者看到結果。
  const [tab, setTab] = useState<(typeof TABS)[number]>(actionData ? '我的八字' : '市場變盤日曆');
  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
        <header>
          <p className="mb-2 text-xs tracking-widest opacity-60">ZI WEI · BA ZI · {taipeiToday}</p>
          <h1 className="text-3xl font-bold">玄學羅盤</h1>
        </header>
        <MetaphysicsDisclaimer />
        {actionData && (
          <p role="status" className={`rounded border p-3 text-sm ${actionData.ok ? 'border-emerald-500/40 text-emerald-300' : 'border-rose-500/40 text-rose-300'}`}>
            {actionData.ok ? actionData.message : actionData.error}
          </p>
        )}
        <nav className="flex gap-2 border-b border-current/15">
          {TABS.map((name) => (
            <button key={name} onClick={() => setTab(name)}
              className={`px-3 py-2 text-sm ${tab === name ? 'border-b-2 border-current font-bold' : 'opacity-60'}`}>{name}</button>
          ))}
        </nav>
        {tab === '市場變盤日曆' && <MarketTimingCalendar markets={markets} />}
        {tab === '我的八字' && <MyBaziPanel bazi={bazi} birth={birth} markets={markets} />}
        {tab === '命中率' && <HitRatePanel markets={markets} />}
      </div>
    </AppLayout>
  );
}
```

- [ ] **Step 9: 建立首頁小卡 `app/features/home/components/MetaphysicsMiniCard.tsx`**

```tsx
/**
 * @component 首頁玄學小卡：今天三個市場的紫微變盤強度＋登入者今日流日等級。
 * 獨立向 /api/metaphysics 取資料，失敗時整張卡不顯示，不影響首頁其他區塊。
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { MoonStar } from 'lucide-react';
import { MetaphysicsDisclaimer } from '../../metaphysics/MetaphysicsDisclaimer';
import { GRADE_CLASS, strengthStars } from '../../metaphysics/dayStyles';

interface TodaySummary {
  markets: Array<{ market: string; label: string; turningStrength: number; directionScore: number }>;
  personal: { grade: string; flags: string[] } | null;
}

export function MetaphysicsMiniCard() {
  const [summary, setSummary] = useState<TodaySummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/metaphysics?view=today')
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (!cancelled) setSummary(body as TodaySummary | null); })
      .catch(() => { /* 小卡是附加資訊，失敗就不顯示 */ });
    return () => { cancelled = true; };
  }, []);
  if (!summary) return null;
  return (
    <Link to="/metaphysics" className="block space-y-2 rounded-sm border border-[#E4E3E0]/15 p-3 text-sm hover:border-[#E4E3E0]/40">
      <div className="flex items-center gap-2 font-semibold"><MoonStar className="h-4 w-4" />今日玄學羅盤</div>
      <ul className="space-y-0.5 text-xs">
        {summary.markets.map((m) => <li key={m.market}>{m.label} 變盤 {strengthStars(m.turningStrength)}</li>)}
      </ul>
      <p className="text-xs">我的流日：{summary.personal
        ? <span className={GRADE_CLASS[summary.personal.grade]}>{summary.personal.grade}{summary.personal.flags.length > 0 && `（${summary.personal.flags.join('、')}）`}</span>
        : '尚未填寫生辰'}</p>
      <MetaphysicsDisclaimer compact />
    </Link>
  );
}
```

- [ ] **Step 10: 加入左側選單、首頁小卡與設定頁連結**

在 `app/components/AppLayout.tsx` 的 lucide-react import 清單中加入 `MoonStar`（加在 `ShieldAlert` 後面），並在 `/tradingview-signals` 那個 `<Link …>` 開始的那一行**之前**插入：

```tsx
          <Link to="/metaphysics" className={navLinkClass('/metaphysics')} title="玄學羅盤（紫微變盤＋八字運勢）" aria-label="玄學羅盤">
            <MoonStar size={20} />
          </Link>
```

在 `app/routes/home.tsx` 加入 import：

```tsx
import { MetaphysicsMiniCard } from '../features/home/components/MetaphysicsMiniCard';
```

並把 `<MacroMarketCompass market={market} />` 改成：

```tsx
          <MacroMarketCompass market={market} />
          <MetaphysicsMiniCard />
```

在 `app/routes/settings.tsx` 的 actionData 訊息區塊（`{(actionData?.message || actionData?.error) && (` 那段）**之後**、`<Form method="post" className="space-y-8">` **之前**插入（設定頁為淺色主題）：

```tsx
          <div className="p-4 rounded-sm border border-[#E4E3E0] bg-white text-sm text-[#141414]">
            生辰資料改在 <Link to="/metaphysics" className="underline">玄學羅盤</Link> 的「我的八字」分頁填寫，資料加密保存。
          </div>
```

`settings.tsx` 已 import `Link`，不需新增 import；只加這一段，不動既有表單與 action。

- [ ] **Step 11: Build**

Run: `npm run build`
Expected: 成功，沒有新的錯誤。若出現「server-only module referenced by client」錯誤，代表某個元件以值匯入了 `*.server.ts`，改成 `import type`。

- [ ] **Step 12: 在本機實際操作頁面**

注意：`wrangler dev` 讀的是 build 產物，改完要先 `npm run build`；`.dev.vars` 會真的發 Slack（本功能不發通知，不受影響）。用 `npm run dev` 啟動後以瀏覽器登入本機帳號（沒有的話到 `/register` 用 `.dev.vars` 的 `INVITATION_CODE` 註冊一個測試帳號），逐項確認：

1. 左側選單出現月亮圖示，點進 `/metaphysics`，頁首有免責聲明。
2. 「市場變盤日曆」切換台股／BTC／美股都有 31 格；美股顯示「時辰為假設」與「超出大限範圍」；今天那格展開後有觸發規則，AI 解說載入後顯示（沒有 AI 金鑰時顯示「規則摘要」）。
3. 「我的八字」填 1990-05-20 23:30 男 → 保存後顯示四柱「年:庚午　月:辛巳　日:丙戌　時:戊子」、身強、性格機會型與研究型、目前大運乙酉。
4. 勾「時辰不明」保存 → 時柱顯示「—」並出現補填提示。
5. 刪除生辰 → 回到填寫表單。
6. 「命中率」分頁的歷史回測列有數字（Task 8 已匯入本機），上線後快照列顯示「資料不足」。
7. 首頁出現「今日玄學羅盤」小卡，點擊進入 `/metaphysics`。
8. 用 `npx wrangler d1 execute crypto-analytics-db --local --command "SELECT * FROM metaphysics_market_forecasts WHERE source = 'live'"` 確認今天的快照已建立（週末時只有 BTC）。

- [ ] **Step 13: Commit**

```bash
git add app/features/metaphysics/MetaphysicsDisclaimer.tsx app/features/metaphysics/NarrativeBox.tsx app/features/metaphysics/dayStyles.ts app/features/metaphysics/MarketTimingCalendar.tsx app/features/metaphysics/BirthProfileForm.tsx app/features/metaphysics/MyBaziPanel.tsx app/features/metaphysics/HitRatePanel.tsx app/features/home/components/MetaphysicsMiniCard.tsx app/routes/metaphysics.tsx app/components/AppLayout.tsx app/routes/home.tsx app/routes/settings.tsx
git commit -m "feat: 玄學羅盤頁面、首頁小卡與選單"
```

注意：`AppLayout.tsx`、`home.tsx`、`settings.tsx` 在 master 上已有與本功能無關的未提交修改。commit 前用 `git diff <檔案>` 檢查；若混有無關修改，改用 `git add -p <檔案>` 只挑本任務的區塊。

---

### Task 10: 功能文件與最終驗證

**Files:**
- Create: `docs/metaphysics-compass.md`

- [ ] **Step 1: 建立 `docs/metaphysics-compass.md`**

````markdown
# 玄學羅盤（紫微變盤＋八字運勢）

玄學參考，非量化訊號，不構成投資建議。本功能不影響漲跌羅盤、選股、自動下單與風控，也不發任何通知。

## 功能

- `/metaphysics`：
  - **市場變盤日曆**：以台股（1962-02-09 證交所開業）、BTC（2009-01-03 創世區塊）、美股（1792-05-17 梧桐樹協議，時辰為假設）的紫微本命盤，疊上流年、流月、流日四化，算出 31 天的方向分數（-100～+100）與變盤強度（0–3）。
  - **我的八字**：生辰加密保存；顯示四柱、日主強弱、喜用神（扶抑法簡化版）、投資性格、大運流年與 31 天流日吉凶，並疊加所選市場的變盤強度。
  - **命中率**：歷史回測與上線後快照的命中率，與基準機率並列，附 95% 信賴區間。
- 首頁「今日玄學羅盤」小卡。

## 規則與資料

- 規則細節：`docs/superpowers/specs/2026-11-09-metaphysics-compass-design.md`，規則版本 `ziwei-v1`、`bazi-v1`。
- 程式：`app/services/metaphysics/`。三個市場本命盤由 `scripts/metaphysics/generate-market-charts.ts` 以 iztro 預先產生；修改 `marketChartSpecs.ts` 後必須重跑產生器並升版規則。
- 資料表（migration 0031）：`user_birth_profiles`（加密生辰）、`metaphysics_market_forecasts`（`source` = `live` 或 `backtest`）、`metaphysics_narrative_cache`。
- 送給 AI 的只有衍生標籤，不含出生日期與四柱。

## 回測結論（2026-11-09，ziwei-v1）

三個市場的變盤命中率與方向命中率都落在基準的 95% 區間內，**與隨機無明顯差異**。詳細數字見回測報告。若要調整規則，必須升版並註明是看過回測後才調整。

## 部署

1. `npm run db:migrate:remote`（套用 migration 0031）。
2. `node --import tsx scripts/metaphysics/backtest-ziwei-timing.ts`
3. `npx wrangler d1 execute crypto-analytics-db --remote --file=output/metaphysics/ziwei-backtest.sql`
4. `npm run deploy`

不需要新增 secret：沿用 `MASTER_ENCRYPTION_KEY` 與既有 AI 設定（`AI_PROVIDER` 等）。
````

- [ ] **Step 2: 跑完本功能全部測試**

Run: `node --import tsx --test tests/metaphysics-*.test.ts`
Expected: 35 個 test 全部 PASS（foundation 4、market-charts 3、ziwei 6、bazi 10、hit-rate 4、store 4、page-data 4）。

- [ ] **Step 3: 確認沒有破壞既有測試**

Run: `node --import tsx --test tests/macro-market-compass.test.ts tests/macro-compass-fixes.test.ts`
Expected: 全部 PASS（本功能不改羅盤，結果應與修改前相同）。

- [ ] **Step 4: Build 與檔案行數檢查**

Run: `npm run build && wc -l app/services/metaphysics/*.ts app/features/metaphysics/*.tsx app/routes/metaphysics.tsx app/routes/settings.tsx app/routes/home.tsx app/components/AppLayout.tsx`
Expected: build 成功；每個手寫檔都低於 1000 行（`marketNatalCharts.generated.ts` 為自動產生檔，不受限）。

- [ ] **Step 5: Commit**

```bash
git add docs/metaphysics-compass.md
git commit -m "docs: 玄學羅盤功能說明與部署步驟"
```

- [ ] **Step 6: 部署前提醒（由使用者決定何時執行）**

正式部署需要使用者同意後再進行：先 `npm run db:migrate:remote`，再匯入回測 SQL（`--remote`），最後 `npm run deploy`。這些是對正式環境的操作，實作者不得自行執行。

