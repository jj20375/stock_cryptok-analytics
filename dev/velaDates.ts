/** @file Vela 0.8 的原生日期沒有語系選項；僅在編譯時翻譯顯示字串，保留時間與交易時區運算。 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin as EsbuildPlugin } from 'esbuild';
import type { Plugin } from 'vite';

/** 明確比對套件的日期片段；套件升級後若格式改變，停止建置以免靜默恢復英文。 */
export function localizeVelaDates(source: string): string {
  if (!source.includes('function formatTimeStamp(')) return source;
  const replacements: [string, string, number][] = [
    ['var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];',
      'var MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];', 1],
    ['var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];',
      'var WEEKDAYS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];', 1],
    ["const date = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} '${pad2(d.getUTCFullYear() % 100)}`;",
      'const date = `${d.getUTCFullYear()}年${MONTHS[d.getUTCMonth()]}${d.getUTCDate()}日（${WEEKDAYS[d.getUTCDay()]}）`;', 1],
    ['label = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;', 'label = `${MONTHS[d.getUTCMonth()]}${d.getUTCDate()}日`;', 2],
    ['label = String(d.getUTCFullYear());', 'label = `${d.getUTCFullYear()}年`;', 1],
    ['months === 12 ? String(Math.floor(idx / 12)) : MONTHS[idx % 12]', 'months === 12 ? `${Math.floor(idx / 12)}年` : MONTHS[idx % 12]', 1],
    ['date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,',
      'date: `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`,', 1],
  ];
  for (const [original, translated, count] of replacements) {
    if (source.split(original).length - 1 !== count) throw new Error('Vela 日期格式已變更，請更新繁體中文日期轉換。');
    source = source.replaceAll(original, translated);
  }
  return source;
}

/** 開發預先打包與正式建置使用同一個轉換，重新安裝套件也不會遺失語系。 */
export function velaDatesPlugins(): { vite: Plugin; esbuild: EsbuildPlugin } {
  const velaFile = /[/\\]node_modules[/\\]@luxalgo[/\\]vela[/\\]dist[/\\].*\.js$/;
  return {
    vite: { name: 'vela-zh-tw-dates', enforce: 'pre', transform(source, id) {
      if (velaFile.test(id)) return localizeVelaDates(source);
    } },
    esbuild: { name: 'vela-zh-tw-dates', setup(build) {
      build.onLoad({ filter: velaFile }, async ({ path: file }) => ({
        contents: localizeVelaDates(await readFile(file, 'utf8')), loader: 'js', resolveDir: path.dirname(file),
      }));
    } },
  };
}
