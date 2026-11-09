/** @file Node20.19.6 公開行情單次篩選；只寫本機報告，不讀帳戶、不送 Slack、不下單。 */
import { mkdir, writeFile } from 'node:fs/promises';
import { collectStockTokenReport } from '../app/services/stockTokenRadar/scanner';

const report = await collectStockTokenReport().catch(error => {
  console.error(error instanceof Error ? error.message : '公開行情篩選失敗');
  process.exit(1);
});
await mkdir('output', { recursive: true });
await writeFile('output/stock-token-radar.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ scannedAt: new Date(report.completedAt).toISOString(), total: report.total, eligible: report.eligible,
  analyzed: report.selected, failed: report.failed, exclusions: report.exclusions,
  entries: report.candidates.filter(c => c.status === 'ENTRY'),
  other: report.candidates.filter(c => c.status !== 'ENTRY').map(c => ({ symbol: c.symbol, status: c.status, reasons: c.reasons })),
  output: 'output/stock-token-radar.json' }, null, 2));
