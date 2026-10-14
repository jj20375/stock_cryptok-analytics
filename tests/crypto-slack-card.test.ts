/** @file 驗證虛擬幣 Block Kit 精簡卡片與三個雷達的獨立頻道隔離。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cryptoEntrySlackChannel } from '../app/services/binancePerpRadar/scanner';
import { potentialCryptoSlackChannel } from '../app/services/potentialRadar/scanner';
import { createCryptoSignalCard, serializeSlackCard, slackPostFromStored } from '../app/services/slack/cryptoSignalCard';
import { waveCryptoSlackChannel } from '../app/services/waveRadar/scanner';

test('Block Kit 卡片保留短 fallback、核心欄位與延遲標示', () => {
  const card = createCryptoSignalCard({
    icon: '🐟', title: 'SOLUSDT｜經典吃大魚', signal: 'Supertrend 確認',
    price: '100 USDT', closedAt: '2026/09/15 23:00（台北）', invalidation: '96 USDT',
    strength: '量能 2.1 倍｜日線向上', risk: '等待收盤確認', source: 'Gate Mark Price',
  });
  assert.ok(card.text.length < 150);
  assert.equal(card.blocks?.length, 4);
  const restored = slackPostFromStored(serializeSlackCard(card), '延遲補送\n');
  assert.match(restored.text, /^延遲補送/);
  assert.equal(restored.blocks?.length, 5);
});

test('舊版長文字補送時壓成四段，避免新頻道洗版', () => {
  const legacy = Array.from({ length: 10 }, (_, index) => `第 ${index + 1} 行詳細資料`).join('\n');
  const post = slackPostFromStored(legacy);
  assert.equal(post.text.split('\n').length, 4);
  assert.equal(post.blocks, undefined);
});

test('三個虛擬幣雷達只讀 CRYPTO_ENTRY_SLACK_CHANNEL_ID，不 fallback 一般頻道', () => {
  const legacyOnly = { DB: {} as any, SLACK_API_TOKEN: 'token', SLACK_CHANNEL_ID: 'old-channel' };
  assert.equal(cryptoEntrySlackChannel(legacyOnly), null);
  assert.equal(potentialCryptoSlackChannel(legacyOnly), null);
  assert.equal(waveCryptoSlackChannel(legacyOnly), null);
  const dedicated = { ...legacyOnly, CRYPTO_SIGNAL_NOTIFICATIONS_ENABLED: 'true', CRYPTO_ENTRY_SLACK_CHANNEL_ID: ' C-CRYPTO ' };
  assert.equal(cryptoEntrySlackChannel(dedicated), 'C-CRYPTO');
  assert.equal(potentialCryptoSlackChannel(dedicated), 'C-CRYPTO');
  assert.equal(waveCryptoSlackChannel(dedicated), 'C-CRYPTO');
});


test('虛擬幣頻道存在時仍預設停用，停用覆蓋三個雷達與舊佇列投遞入口', () => {
  const env = { DB: {} as any, CRYPTO_ENTRY_SLACK_CHANNEL_ID: 'C-CRYPTO' };
  for (const resolve of [cryptoEntrySlackChannel, potentialCryptoSlackChannel, waveCryptoSlackChannel]) {
    assert.equal(resolve(env), null);
    assert.equal(resolve({ ...env, CRYPTO_SIGNAL_NOTIFICATIONS_ENABLED: 'false' }), null);
    assert.equal(resolve({ ...env, CRYPTO_SIGNAL_NOTIFICATIONS_ENABLED: 'true' }), 'C-CRYPTO');
  }
});
