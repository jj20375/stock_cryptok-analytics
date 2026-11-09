/**
 * @file /metaphysics 頁面與 /api/metaphysics 的資料組裝。
 * 副作用：寫入當日紫微快照、回填已收盤日期的實際漲跌（會呼叫外部行情 API）、讀寫加密生辰、呼叫 AI。
 * 任何快照或行情失敗都只記 log，不讓頁面失敗；結果不寫入任何交易或羅盤資料。
 */
import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from 'react-router';
import { getUserId } from '../../utils/auth';
import { buildBaziProfile, type BaziProfile, type BirthInput, type DaYun } from './baziProfile';
import { currentDaYun, dailyLuckRange, flowPillarsOf, gradePillar, type DailyLuck, type PillarLuck } from './baziLuck';
import { parseBirthForm } from './birthInput';
import { deleteBirthProfile, loadBirthProfile, saveBirthProfile, type D1Binding } from './birthProfileStore.server';
import { addDays, localDateOf } from './calendarTime';
import { applyOutcomes, listPendingLiveDates, loadScoredRows, recordLiveForecast, shouldSnapshot } from './forecastStore.server';
import { classifyOutcomes, summarizeHitRate, type HitRateSummary } from './hitRate';
import { fetchRecentDailyBars } from './marketBars.server';
import { MARKET_BIRTH_YEAR, MARKET_CHART_SPECS, type MetaMarket } from './marketChartSpecs';
import { MARKET_NATAL_CHARTS } from './marketNatalCharts.generated';
import { getNarrative, type NarrativeKind } from './narrative.server';
import { baziDailyFacts, baziProfileFacts, marketFacts } from './narrativeFacts';
import { BAZI_RULE_VERSION, ZIWEI_RULE_VERSION, type ZiweiDayResult } from './types';
import { currentDecadalPalace, evaluateZiweiDay } from './ziweiTiming';

type MetaEnv = Record<string, unknown> & { DB: D1Binding; MASTER_ENCRYPTION_KEY?: string };
const envOf = (context: unknown) => (context as { cloudflare: { env: MetaEnv } }).cloudflare.env;

/** 日曆顯示天數：今天＋未來 30 天。 */
export const CALENDAR_DAYS = 31;
export const MARKETS: MetaMarket[] = ['TW', 'CRYPTO', 'US'];
/** 個人運勢以台北日期為準（使用者在台灣）。 */
const PERSONAL_TIME_ZONE = 'Asia/Taipei';

export interface MarketCalendar {
  market: MetaMarket;
  label: string;
  birthNote: string;
  timeAssumed: boolean;
  today: string;
  days: ZiweiDayResult[];
  decadal: { name: string; range: [number, number] } | null;
  hitRate: { backtest: HitRateSummary; live: HitRateSummary };
}

export interface BaziView {
  profile: BaziProfile;
  daYun: (DaYun & { luck: PillarLuck }) | null;
  yearLuck: PillarLuck;
  monthLuck: PillarLuck;
  days: DailyLuck[];
}

export function buildMarketDays(market: MetaMarket, today: string): ZiweiDayResult[] {
  return Array.from({ length: CALENDAR_DAYS }, (_, i) => evaluateZiweiDay(market, addDays(today, i)));
}

export function buildBaziView(birth: BirthInput, taipeiToday: string): BaziView {
  const profile = buildBaziProfile(birth);
  const flow = flowPillarsOf(taipeiToday);
  const yun = currentDaYun(profile, Number(taipeiToday.slice(0, 4)));
  return {
    profile,
    daYun: yun ? { ...yun, luck: gradePillar(profile, { stem: yun.stem, branch: yun.branch }) } : null,
    yearLuck: gradePillar(profile, flow.year, profile.pillars.day.branch),
    monthLuck: gradePillar(profile, flow.month),
    days: dailyLuckRange(profile, taipeiToday, CALENDAR_DAYS),
  };
}

/** 寫入今天的上線快照，並回填已收盤但尚未回填的日期；失敗只記 log。 */
async function syncLiveSnapshots(db: D1Binding, market: MetaMarket, today: ZiweiDayResult): Promise<void> {
  try {
    if (shouldSnapshot(market, today.tradeDate)) await recordLiveForecast(db, today);
    const pending = await listPendingLiveDates(db, market, today.tradeDate);
    if (pending.length === 0) return;
    const outcomes = classifyOutcomes(await fetchRecentDailyBars(market)).filter((o) => pending.includes(o.date));
    await applyOutcomes(db, market, outcomes);
  } catch (error) {
    console.error(`[Metaphysics] ${market} 快照或回填失敗`, error);
  }
}

async function loadMarketCalendar(db: D1Binding, market: MetaMarket, now: number): Promise<MarketCalendar> {
  const spec = MARKET_CHART_SPECS[market];
  const today = localDateOf(now, spec.timeZone);
  const days = buildMarketDays(market, today);
  await syncLiveSnapshots(db, market, days[0]);
  const [backtestRows, liveRows] = await Promise.all([loadScoredRows(db, market, 'backtest'), loadScoredRows(db, market, 'live')]);
  const decadal = currentDecadalPalace(MARKET_NATAL_CHARTS[market], MARKET_BIRTH_YEAR[market], Number(today.slice(0, 4)));
  return { market, label: spec.label, birthNote: spec.birthNote, timeAssumed: spec.timeAssumed, today, days,
    decadal: decadal ? { name: decadal.name, range: decadal.decadalRange } : null,
    hitRate: { backtest: summarizeHitRate(backtestRows), live: summarizeHitRate(liveRows) } };
}

export async function loadMetaphysicsPage({ request, context }: LoaderFunctionArgs) {
  const env = envOf(context);
  const userId = await getUserId(request, env);
  if (!userId) throw redirect('/login');
  const now = Date.now();
  const taipeiToday = localDateOf(now, PERSONAL_TIME_ZONE);
  const markets = await Promise.all(MARKETS.map((market) => loadMarketCalendar(env.DB, market, now)));
  const birth = await loadBirthProfile(env.DB, env.MASTER_ENCRYPTION_KEY, userId);
  let bazi: BaziView | null = null;
  try { bazi = birth ? buildBaziView(birth, taipeiToday) : null; }
  catch (error) { console.error('[Metaphysics] 八字排盤失敗', error); }
  return { markets, bazi, birth, taipeiToday };
}

export async function metaphysicsAction({ request, context }: ActionFunctionArgs) {
  const env = envOf(context);
  const userId = await getUserId(request, env);
  if (!userId) throw redirect('/login');
  const form = await request.formData();
  const intent = form.get('intent');
  if (intent === 'deleteBirth') {
    await deleteBirthProfile(env.DB, userId);
    return { ok: true as const, message: '已刪除生辰資料與個人解說快取' };
  }
  if (intent !== 'saveBirth') return { ok: false as const, error: '未知的操作' };
  const parsed = parseBirthForm(form, new Date().getUTCFullYear());
  // 專案 tsconfig 未開 strict，布林判別式無法收窄型別，改用 'in' 判斷。
  if ('error' in parsed) return { ok: false as const, error: parsed.error };
  try {
    await saveBirthProfile(env.DB, env.MASTER_ENCRYPTION_KEY, userId, parsed.value);
    return { ok: true as const, message: '生辰已加密保存' };
  } catch (error) {
    console.error('[Metaphysics] 保存生辰失敗', error);
    return { ok: false as const, error: '保存失敗，請稍後再試' };
  }
}

const NARRATIVE_KINDS: NarrativeKind[] = ['market_TW', 'market_CRYPTO', 'market_US', 'bazi_profile', 'bazi_daily'];

/** GET /api/metaphysics?view=today｜narrative&kind=…。只回傳登入者自己的資料。 */
export async function loadMetaphysicsApi({ request, context }: LoaderFunctionArgs) {
  const env = envOf(context);
  const userId = await getUserId(request, env);
  if (!userId) return Response.json({ error: '請先登入' }, { status: 401 });
  const url = new URL(request.url);
  const now = Date.now();
  const taipeiToday = localDateOf(now, PERSONAL_TIME_ZONE);
  if (url.searchParams.get('view') === 'today') {
    const markets = MARKETS.map((market) => {
      const result = evaluateZiweiDay(market, localDateOf(now, MARKET_CHART_SPECS[market].timeZone));
      return { market, label: MARKET_CHART_SPECS[market].label, turningStrength: result.turningStrength, directionScore: result.directionScore };
    });
    const birth = await loadBirthProfile(env.DB, env.MASTER_ENCRYPTION_KEY, userId);
    const personal = birth ? buildBaziView(birth, taipeiToday).days[0] : null;
    return Response.json({ markets, personal: personal ? { grade: personal.grade5, flags: personal.flags } : null });
  }
  const kind = url.searchParams.get('kind') as NarrativeKind;
  if (!NARRATIVE_KINDS.includes(kind)) return Response.json({ error: '不支援的解說種類' }, { status: 400 });
  if (kind.startsWith('market_')) {
    const market = kind.slice('market_'.length) as MetaMarket;
    const spec = MARKET_CHART_SPECS[market];
    const result = evaluateZiweiDay(market, localDateOf(now, spec.timeZone));
    const { facts, fallback } = marketFacts(spec.label, result);
    return Response.json(await getNarrative({ db: env.DB, env, userId: 0, kind, cacheDate: result.tradeDate,
      ruleVersion: ZIWEI_RULE_VERSION, facts, fallback }));
  }
  const birth = await loadBirthProfile(env.DB, env.MASTER_ENCRYPTION_KEY, userId);
  if (!birth) return Response.json({ error: '尚未填寫生辰' }, { status: 404 });
  const view = buildBaziView(birth, taipeiToday);
  const { facts, fallback } = kind === 'bazi_profile' ? baziProfileFacts(view.profile)
    : baziDailyFacts(view.days[0], view.yearLuck, view.daYun?.luck ?? null);
  return Response.json(await getNarrative({ db: env.DB, env, userId, kind, cacheDate: taipeiToday,
    ruleVersion: BAZI_RULE_VERSION, facts, fallback }));
}
