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
