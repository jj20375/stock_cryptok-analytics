/** @file 美股 rToken 卡片：明示計價、報價時間、有效期與估算費率，不使用 AI 改價格。 */
import { createCryptoSignalCard } from '../slack/cryptoSignalCard';
import type { StockTokenCandidate } from './types';

export const stockTokenNoticeId = (candidate: StockTokenCandidate) => `${candidate.symbol}:${candidate.plan!.closedAt}`;
const price = (value: number) => `${value.toLocaleString('en-US', { maximumFractionDigits: 6 })} USDT`;
const time = (value: number) => new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });

export function stockTokenSlackCard(candidate: StockTokenCandidate) {
  const { plan, quote } = candidate;
  if (!plan || !quote) throw new Error('缺少股票代幣進場計畫');
  return createCryptoSignalCard({ icon: '🇺🇸', title: `美股現貨代幣 ${candidate.baseCoin}（${candidate.symbol}）`,
    signal: `做多候選｜${plan.kind === 'BREAKOUT' ? '1h 放量突破' : '1h 回踩轉強'}＋4h 多頭`,
    price: `${price(plan.entryLow)} ～ ${price(plan.entryHigh)}；買一 ${price(quote.ask)}`,
    closedLabel: '1h 收盤／有效截止（台北）', closedAt: `${time(plan.closedAt)}／${time(plan.expiresAt)}`,
    invalidation: `${price(plan.stopPrice)}；目標 ${price(plan.targetPrice)}`,
    strength: `${candidate.reasons.join('；')}。訊號收盤 ${price(plan.referencePrice)}。平台24h額 ${(quote.platformTurnover / 10_000).toFixed(1)} 萬 USDT；價差 ${quote.spreadPct.toFixed(3)}%；報價 ${time(quote.timestamp)}`,
    risk: `預估風險 ${plan.riskPct.toFixed(2)}%；估算單邊費率0.1%後 ${plan.netRewardRisk.toFixed(2)}R。離開進場區間即失效；代幣與原股可能有價差，未驗證勝率。`,
    source: 'Bitget v3 SPOT rToken｜系統自算｜每5分鐘掃描｜不自動下單',
  });
}
