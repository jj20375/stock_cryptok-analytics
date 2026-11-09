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
