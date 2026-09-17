/** @file 驗證美股日報卡片的摘要、排行、總經與策略區塊，不呼叫 Slack。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUsStockDailyCard } from '../app/services/slack/usStockDailyCard';

const movers = [
  { symbol: 'NVDA', name: 'NVIDIA Corporation', changePercent: 6.1234, volume: 188_500_000 },
  { symbol: 'TSLA', name: 'Tesla, Inc.', changePercent: 4.5, volume: 121_200_000 },
];

test('美股市場日報使用精簡 fallback 與分區卡片', () => {
  const post = createUsStockDailyCard({
    date: '2026/9/16', type: 'market', topGainers: movers, mostActive: [...movers].reverse(),
    macro: { riskState: '中性', reason: '殖利率與波動率維持區間', us10y: '4.100% · 持平',
      dxy: '101.200 · 下降', vix: '16.20 · 下降', yieldSpread: '0.250%' },
  });
  assert.ok(post.text.length < 180);
  assert.match(post.text, /NVDA/);
  const content = JSON.stringify(post.blocks);
  assert.match(content, /美股市場日報/);
  assert.match(content, /總經風向/);
  assert.match(content, /漲幅領先 Top 5/);
  assert.match(content, /交投活躍 Top 5/);
  assert.match(content, /188\.5M/);
});

test('美股策略日報將三模式候選與 AI 觀察拆成卡片區塊', () => {
  const post = createUsStockDailyCard({
    date: '2026/9/16', type: 'strategy', topGainers: movers, mostActive: movers,
    strategySections: [{
      title: '多空趨勢強勢追蹤', trendHint: '偏向順勢、找回調', insight: '等待量價再次確認。',
      candidates: [{ symbol: 'NVDA', name: 'NVIDIA Corporation', score: 88, reason: '均線多頭且動能轉強', trend: 'up' }],
    }],
  });
  const content = JSON.stringify(post.blocks);
  assert.match(post.text, /AI 三模式策略日報/);
  assert.match(content, /多空趨勢強勢追蹤/);
  assert.match(content, /88 分/);
  assert.match(content, /AI 觀察/);
  assert.match(content, /投資有風險/);
});
