/** @file 以攔截的 Yahoo／Slack 回應走過 runStockDailyStrategy 美股分支，確認 Block Kit 卡片真的送出；不連外、不發真實訊息。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runStockDailyStrategy } from '../app/services/strategyEngine';

const quotes = [
  { symbol: 'NVDA', shortName: 'NVIDIA Corporation', regularMarketPrice: 120, regularMarketChangePercent: 6.12, regularMarketVolume: 188_500_000 },
  { symbol: 'TSLA', shortName: 'Tesla, Inc.', regularMarketPrice: 250, regularMarketChangePercent: 4.5, regularMarketVolume: 121_200_000 },
];

test('美股市場日報經由排程入口送出 Block Kit 卡片', async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const slackBodies: Array<{ channel: string; text: string; blocks?: unknown[] }> = [];
  const errors: unknown[][] = [];
  try {
    // 【詳細繁體中文註解】：runStockDailyStrategy 內部以 try/catch 吞掉例外，必須攔截 console.error 才能抓到 ReferenceError 這類回歸。
    console.error = (...args: unknown[]) => { errors.push(args); };
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === 'slack.com') {
        slackBodies.push(JSON.parse(String(init?.body)));
        return Response.json({ ok: true });
      }
      if (url.pathname.includes('/screener/')) {
        return Response.json({ finance: { result: [{ quotes }] } });
      }
      // 【詳細繁體中文註解】：總經指標一律回 404，讓 getMacroIndicators 回傳 null，日報仍須照常送出（macro 區塊省略）。
      return new Response('not found', { status: 404 });
    };

    await runStockDailyStrategy({ SLACK_API_TOKEN: 'xoxb-test', SLACK_CHANNEL_ID: 'C_TEST' }, 'US', 'market');
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }

  const crash = errors.find(args => String(args[0]).includes('[runStockDailyStrategy]'));
  assert.equal(crash, undefined, `美股日報流程拋出例外：${crash?.map(String).join(' ')}`);
  assert.equal(slackBodies.length, 1);
  const [body] = slackBodies;
  assert.equal(body.channel, 'C_TEST');
  assert.ok(Array.isArray(body.blocks) && body.blocks.length > 0, '應以 Block Kit 卡片送出');
  const content = JSON.stringify(body.blocks);
  assert.match(content, /美股市場日報/);
  assert.match(content, /NVDA/);
});
