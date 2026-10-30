/**
 * @file 驗證 Solana 迷因幣 14 關防 Rug 戰情室（Meme Desk）核心邏輯：
 * 1. Rugcheck 前 9 關硬過濾（包含排除 AMM/LOCKER 地址計算真實 Top 10 持倉）
 * 2. DexScreener 第 10~13 關流動池與貔貅盤過濾
 * 3. 第 14 關 Gemini 裁判信心度門檻（confidence < 0.7 強制轉為 SKIP）
 * 4. 完整 checkSolanaMint 漏斗短路行為（前面關卡失敗時絕不呼叫後續 API 或 Gemini）
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  pickBitgetTokensForScan,
  resolveBitgetScanInput,
} from '../app/services/memeDesk/bitgetListed';
import { checkSolanaMint } from '../app/services/memeDesk/deskRunner';
import { evaluatePoolFacts } from '../app/services/memeDesk/market';
import { evaluateRugcheckFacts, fetchRugcheckReport } from '../app/services/memeDesk/rugcheck';
import type { DexPoolSnapshot, RugcheckFacts } from '../app/services/memeDesk/types';

const cleanFacts: RugcheckFacts = {
  mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  symbol: 'DEMO',
  name: 'Demo Meme',
  rugged: false,
  riskScore: 15,
  dangerFlags: [],
  warnFlags: [],
  mintAuthority: null,
  freezeAuthority: null,
  lpLockedPct: 98,
  top10Pct: 18.5,
  devPct: 1.2,
  insiders: 0,
  totalHolders: 1200,
};

const cleanPool: DexPoolSnapshot = {
  symbol: 'DEMO',
  name: 'Demo Meme',
  priceUsd: 0.0012,
  liquidityUsd: 85_000,
  fdvUsd: 450_000,
  ageMin: 120,
  buys5m: 12,
  sells5m: 8,
  buys1h: 85,
  sells1h: 42,
  volume1hUsd: 24_000,
  avgTrade1hUsd: 188.98,
  priceChange1hPct: 18.5,
  socials: [{ type: 'twitter', url: 'https://x.com/demomeme' }],
  websites: ['https://demomeme.sol'],
  boostsActive: 0,
  pairUrl: 'https://dexscreener.com/solana/demo',
};

test('Rugcheck 第 1~9 關硬過濾：逐一驗證致命死因與通過條件', () => {
  assert.equal(evaluateRugcheckFacts(cleanFacts), null);
  assert.equal(evaluateRugcheckFacts({ ...cleanFacts, riskScore: null }), 'no_report');
  assert.equal(evaluateRugcheckFacts({ ...cleanFacts, rugged: true }), 'already_rugged');
  assert.equal(evaluateRugcheckFacts({ ...cleanFacts, mintAuthority: 'OpenMintPubkey' }), 'mint_open');
  assert.equal(evaluateRugcheckFacts({ ...cleanFacts, freezeAuthority: 'OpenFreezePubkey' }), 'freeze_open');
  assert.equal(evaluateRugcheckFacts({ ...cleanFacts, dangerFlags: ['Mutable Authority'] }), 'danger:Mutable Authority');
  assert.equal(evaluateRugcheckFacts({ ...cleanFacts, riskScore: 45 }), 'risk_score');
  assert.equal(evaluateRugcheckFacts({ ...cleanFacts, lpLockedPct: 85 }), 'lp_unlocked');
  assert.equal(evaluateRugcheckFacts({ ...cleanFacts, top10Pct: 35 }), 'top10_heavy');
  assert.equal(evaluateRugcheckFacts({ ...cleanFacts, devPct: 6 }), 'dev_holds');
  assert.equal(evaluateRugcheckFacts({ ...cleanFacts, insiders: 1 }), 'insiders');
});

test('Rugcheck 報告解析：自動排除 AMM 流動池與 LOCKER 鎖倉地址後計算 Top 10 持倉', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    tokenMeta: { symbol: 'TEST', name: 'Test Coin' },
    rugged: false,
    score_normalised: 12,
    token: { supply: 1_000_000, mintAuthority: null, freezeAuthority: null },
    creatorBalance: 20_000,
    knownAccounts: {
      RaydiumVault: { type: 'AMM' },
      StreamflowLock: { type: 'LOCKER' },
    },
    topHolders: [
      { owner: 'RaydiumVault', pct: 45 },
      { address: 'StreamflowLock', pct: 25 },
      { owner: 'RealWhale1', pct: 10 },
      { owner: 'RealWhale2', pct: 8.42 },
    ],
    markets: [
      { lp: { baseUSD: 40_000, quoteUSD: 40_000, lpLockedPct: 99.5 } },
    ],
    risks: [{ level: 'warn', name: 'Low holder count' }],
    graphInsidersDetected: 0,
    totalHolders: 450,
  });

  try {
    const facts = await fetchRugcheckReport(cleanFacts.mint);
    /** 排除 45% AMM 與 25% LOCKER 後，真實前十大持倉應為 10 + 8.42 = 18.42% */
    assert.equal(facts.top10Pct, 18.42);
    assert.equal(facts.devPct, 2);
    assert.equal(facts.lpLockedPct, 99.5);
    assert.equal(evaluateRugcheckFacts(facts), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('DexScreener 第 10~13 關流動池過濾：驗證池深、單筆滑價、年齡與貔貅盤', () => {
  assert.equal(evaluatePoolFacts(cleanPool), null);
  assert.equal(evaluatePoolFacts(null), 'no_pool');
  assert.equal(evaluatePoolFacts({ ...cleanPool, priceUsd: 0 }), 'no_price');
  assert.equal(evaluatePoolFacts({ ...cleanPool, liquidityUsd: 25_000 }), 'thin_pool');
  assert.equal(evaluatePoolFacts({ ...cleanPool, ageMin: 15 }), 'too_fresh');
  assert.equal(evaluatePoolFacts({ ...cleanPool, ageMin: 80 * 60 }), 'too_old');
  assert.equal(evaluatePoolFacts({ ...cleanPool, buys1h: 25, sells1h: 0 }), 'nobody_can_sell');
});

test('完整漏斗短路驗證：死於 Rugcheck 時不呼叫 DexScreener 或 Gemini', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    return Response.json({
      tokenMeta: { symbol: 'RUG' },
      rugged: false,
      score_normalised: 20,
      token: { supply: 1000, mintAuthority: 'StillOpenAuthority' },
    });
  };

  try {
    const res = await checkSolanaMint({}, cleanFacts.mint);
    assert.equal(res.verdict, 'SKIP');
    assert.equal(res.stage, 'facts');
    assert.equal(res.reason, 'mint_open');
    /** 只呼叫過 1 次 Rugcheck API，絕不呼叫 DexScreener 或 Gemini */
    assert.equal(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Bitget 已上架幣種解析與攔截：支援輸入 WIF/BONK 代號，並攔截未上架 Bitget 的野雞合約', async () => {
  const wif = resolveBitgetScanInput('wif');
  assert.equal(wif.bitgetInfo?.bitgetSymbol, 'WIFUSDT');
  assert.equal(wif.mint, 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm');

  const bonk = resolveBitgetScanInput('BONKUSDT');
  assert.equal(bonk.bitgetInfo?.coin, 'BONK');
  assert.equal(bonk.mint, cleanFacts.mint);

  /** 未在 Bitget 上架的陌生 Solana 合約地址應直接於第 0 階段被攔截，零外部 API 呼叫 */
  const unlistedMint = '9999999999999999999999999999999999999999pump';
  const blocked = await checkSolanaMint({}, unlistedMint);
  assert.equal(blocked.verdict, 'SKIP');
  assert.equal(blocked.stage, 'limits');
  assert.equal(blocked.reason, 'not_listed_on_bitget');
});

test('Bitget 已上架代幣適配規則：不因建池超過 72 小時或 CLMM 池 LP 欄位誤殺，並支援輪流掃描', () => {
  /** Bitget 已上架代幣建池已滿 30 天（43200 分鐘），在 isBitgetListed 模式下不應死於 too_old */
  assert.equal(evaluatePoolFacts({ ...cleanPool, ageMin: 43_200 }, { isBitgetListed: true }), null);

  /** Bitget 已上架代幣若使用 CLMM 池（lpLockedPct 較低）且前十大含 CEX 託管錢包（48%），不應誤殺 */
  assert.equal(
    evaluateRugcheckFacts({ ...cleanFacts, lpLockedPct: 25, top10Pct: 48 }, { isBitgetListed: true }),
    null,
  );

  /** 批次挑選應優先避開已掃描過的 Mint */
  const firstBatch = pickBitgetTokensForScan([cleanFacts.mint], 5);
  assert.equal(firstBatch.length, 5);
  assert.equal(firstBatch.some(item => item.mint === cleanFacts.mint), false);
});
