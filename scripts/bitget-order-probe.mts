/**
 * @file Bitget USDT 永續下單路徑手動驗證工具（由本人在終端機執行）。
 *
 * 用途：驗證「設定全倉槓桿 → 市價開多並附原生停損 → 平倉」這段交易所寫入流程，
 * 直接呼叫 app/services/bitgetService.ts，不經過自動化引擎，也不寫入本機 D1。
 *
 * ⚠️ 外部副作用：
 * - `open`／`close` 會對 Bitget 送出真實委託；`live` 為正式盤真實資金。
 * - `open` 會把該商品的保證金模式改為全倉並設定槓桿。
 * - 測試部位存在期間，自動化引擎偵測到「其他來源部位」會拒絕所有新倉，測完請平倉。
 *
 * 用法：npx tsx scripts/bitget-order-probe.mts <demo|live> <check|open|close> [商品，預設 XRPUSDT]
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { BitgetApiError, closeBitgetFuturesLong, configureBitgetFuturesLong, fetchBitgetFuturesAccount,
  fetchBitgetFuturesMarkPrice, fetchBitgetFuturesRules, placeBitgetFuturesLong } from '../app/services/bitgetService';
import { fetchLedgerSnapshot } from '../app/services/bitgetLedger/api.server';
import { decryptData } from '../app/utils/encryption';

const [, , envArg, command, symbolArg] = process.argv;
if (!['demo', 'live'].includes(envArg ?? '') || !['check', 'open', 'close'].includes(command ?? '')) {
  console.error('用法：npx tsx scripts/bitget-order-probe.mts <demo|live> <check|open|close> [商品，預設 XRPUSDT]');
  process.exit(1);
}
const ENV = envArg === 'live' ? 'LIVE' : 'DEMO';
/** 預設選自動化清單以外的商品，避免與自動化同商品部位混在一起。 */
const SYMBOL = (symbolArg ?? 'XRPUSDT').toUpperCase();
/** 1 倍全倉：保證金約等於名目，只為驗證 API，不放大部位。 */
const LEVERAGE = 1;
/** 目標名目 6 USDT，略高於交易所常見 5 USDT 最小名目。 */
const TARGET_NOTIONAL_USDT = 6;
/** 原生停損設在現價下方 5%，用來確認交易所接受停損參數。 */
const STOP_LOSS_PCT = 0.05;

const root = new URL('..', import.meta.url).pathname;

/** 開發伺服器持有 WAL，直接唯讀開檔會失敗；複製到暫存目錄查完即刪。 */
function readCredentialColumns() {
  const dir = join(root, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  const file = readdirSync(dir).find(name => name.endsWith('.sqlite'));
  if (!file) throw new Error('找不到本機 D1 資料庫');
  const temp = mkdtempSync(join(tmpdir(), 'bitget-probe-'));
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(join(dir, file + suffix))) copyFileSync(join(dir, file + suffix), join(temp, file + suffix));
    }
    const prefix = ENV === 'LIVE' ? 'bitget_futures_live' : 'bitget_demo';
    const row = execFileSync('sqlite3', ['-separator', '\t', join(temp, file),
      `select ${prefix}_api_key, ${prefix}_api_secret, ${prefix}_passphrase from users where id = 1`], { encoding: 'utf8' }).trim();
    return row.split('\t');
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

/** 只取主加密金鑰，不輸出任何值。 */
const masterKey = readFileSync(join(root, '.dev.vars'), 'utf8').split('\n')
  .find(line => line.startsWith('MASTER_ENCRYPTION_KEY='))?.slice('MASTER_ENCRYPTION_KEY='.length).trim().replace(/^["']|["']$/g, '');
if (!masterKey) throw new Error('.dev.vars 缺少 MASTER_ENCRYPTION_KEY');
const [encKey, encSecret, encPass] = readCredentialColumns();
if (!encKey || !encSecret || !encPass) throw new Error(`本機使用者缺少完整 ${ENV} 合約憑證`);
const creds = {
  apiKey: await decryptData(encKey, masterKey),
  apiSecret: await decryptData(encSecret, masterKey),
  passphrase: await decryptData(encPass, masterKey),
};
const scope = { id: 'order-probe', userId: 1, environment: ENV } as const;

/** 送單前要求本人輸入 YES；非互動環境（管線、背景）一律無法通過。 */
async function confirm(message: string) {
  if (!process.stdin.isTTY) throw new Error('需要在互動式終端機由本人確認，已取消');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${message}\n輸入 YES 確認送出，其他任何輸入取消：`);
  rl.close();
  if (answer.trim() !== 'YES') throw new Error('已取消，未送出任何委託');
}

const positions = async (dialect: 'UTA_V3' | 'CLASSIC_V2') =>
  (await fetchLedgerSnapshot(dialect, creds, scope)).positions as Array<{ symbol: string; side: string; quantity: string }>;
const describe = (list: Array<{ symbol: string; side: string; quantity: string }>) =>
  list.length ? list.map(p => `${p.symbol} ${p.side} ${p.quantity}`).join('；') : '無';

try {
  const banner = ENV === 'LIVE' ? '⚠️ 正式盤（真實資金）' : '🧪 Demo 模擬盤';
  console.log(`環境：${banner}｜Key 末碼 …${creds.apiKey.slice(-6)}｜商品 ${SYMBOL}`);
  const account = await fetchBitgetFuturesAccount(ENV, SYMBOL, creds.apiKey, creds.apiSecret, creds.passphrase);
  console.log(`[帳戶] API=${account.apiDialect} 持倉模式=${account.positionMode} 保證金模式=${account.marginMode || '(未回傳)'}`);
  const rules = await fetchBitgetFuturesRules(SYMBOL);
  const price = await fetchBitgetFuturesMarkPrice(SYMBOL);
  console.log(`[規格] 最小數量=${rules.minTradeQuantity} 步進=${rules.sizeMultiplier} 最小名目=${rules.minTradeUsdt} USDT 槓桿=${rules.minLeverage}~${rules.maxLeverage} Mark=${price}`);
  const before = await positions(account.apiDialect);
  console.log(`[持倉] ${describe(before)}`);

  if (command === 'open') {
    if (before.some(p => p.symbol === SYMBOL)) throw new Error(`已有 ${SYMBOL} 部位，停止以免混倉`);
    if (rules.minLeverage > LEVERAGE) throw new Error(`${SYMBOL} 最低槓桿 ${rules.minLeverage} 倍，高於測試設定`);
    const step = rules.sizeMultiplier;
    const rawQty = Math.max(rules.minTradeQuantity, Math.max(TARGET_NOTIONAL_USDT, rules.minTradeUsdt * 1.1) / price);
    const quantity = Number((Math.ceil(rawQty / step) * step).toFixed(rules.quantityPrecision));
    const stopLossPrice = Number((price * (1 - STOP_LOSS_PCT)).toFixed(rules.pricePrecision));
    await confirm(`[計畫] ${banner} 市價開多 ${quantity} ${SYMBOL}（名目約 ${(quantity * price).toFixed(2)} USDT），全倉 ${LEVERAGE}x，原生停損 ${stopLossPrice}`);
    await configureBitgetFuturesLong(ENV, SYMBOL, account, LEVERAGE, creds.apiKey, creds.apiSecret, creds.passphrase, 'long', 'crossed');
    console.log('[設定] 全倉與槓桿設定成功');
    const receipt = await placeBitgetFuturesLong({
      environment: ENV, symbol: SYMBOL, quantity, quantityPrecision: rules.quantityPrecision,
      stopLossPrice, pricePrecision: rules.pricePrecision, positionMode: account.positionMode,
      apiDialect: account.apiDialect, marginMode: 'crossed', clientOid: `probe${Date.now()}`, ...creds,
    });
    console.log(`[下單] 委託已接受 orderId=${receipt.orderId}`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log(`[持倉] ${describe(await positions(account.apiDialect))}`);
    console.log('請到 Bitget 核對：委託成交、持倉，以及持倉上的止盈止損是否顯示停損價。測完執行 close 平倉。');
  }

  if (command === 'close') {
    const held = before.find(p => p.symbol === SYMBOL && p.side === 'long');
    if (!held) throw new Error(`沒有 ${SYMBOL} 多單可平`);
    await confirm(`[計畫] ${banner} 平倉 ${SYMBOL} 多單 ${held.quantity}（只減倉，不會反手開空）`);
    const receipt = await closeBitgetFuturesLong(ENV, SYMBOL, held.quantity, creds.apiKey, creds.apiSecret, creds.passphrase, `probeclose${Date.now()}`, 'long');
    console.log(`[平倉] 委託已接受 orderId=${receipt.orderId}`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log(`[持倉] ${describe(await positions(account.apiDialect))}`);
  }
} catch (error) {
  /** 只顯示錯誤碼與端點，不回顯簽章或憑證。 */
  console.error(error instanceof BitgetApiError ? `[失敗] Bitget code=${error.code} 端點=${error.requestPath}｜${error.message}`
    : `[失敗] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
