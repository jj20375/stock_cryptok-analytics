/** @file 美股市場與策略日報的精簡 Slack Block Kit；只負責格式，不執行網路副作用。 */
import type { SlackPostPayload } from '../slackService';

export interface UsDailyMover {
  symbol: string;
  name: string;
  changePercent: number;
  volume: number;
  themeBadge?: string;
}

export interface UsDailyMacro {
  riskState: string;
  reason: string;
  us10y: string;
  dxy: string;
  vix: string;
  yieldSpread: string;
}

export interface UsDailyStrategyCandidate {
  symbol: string;
  name: string;
  score: number;
  reason: string;
  trend: 'up' | 'down';
  themeBadge?: string;
}

export interface UsDailyStrategySection {
  title: string;
  trendHint: string;
  insight: string;
  candidates: UsDailyStrategyCandidate[];
}

export interface UsStockDailyCardInput {
  date: string;
  type: 'market' | 'strategy';
  topGainers: UsDailyMover[];
  mostActive: UsDailyMover[];
  macro?: UsDailyMacro | null;
  strategySections?: UsDailyStrategySection[];
  themeSummary?: string;
}

const truncate = (value: string, maximum: number) => value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
const escapeMrkdwn = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const percent = (value: number) => Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : '—';
const volume = (value: number) => Number.isFinite(value)
  ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  : '—';

const moverName = (item?: UsDailyMover) => item
  ? `*${escapeMrkdwn(item.symbol)}* · ${escapeMrkdwn(truncate(item.name, 38))}`
  : '暫無資料';

const formatGainers = (items: UsDailyMover[]) => items.length
  ? items.slice(0, 5).map((item, index) => {
      const badge = item.themeBadge ? `\n   ${escapeMrkdwn(item.themeBadge)}` : '';
      return `${index + 1}. *${escapeMrkdwn(item.symbol)}*  ${percent(item.changePercent)}\n   ${escapeMrkdwn(truncate(item.name, 44))}${badge}`;
    }).join('\n')
  : '暫無資料';

const formatActive = (items: UsDailyMover[]) => items.length
  ? items.slice(0, 5).map((item, index) => {
      const badge = item.themeBadge ? `\n   ${escapeMrkdwn(item.themeBadge)}` : '';
      return `${index + 1}. *${escapeMrkdwn(item.symbol)}*  ${volume(item.volume)}\n   ${escapeMrkdwn(truncate(item.name, 44))}${badge}`;
    }).join('\n')
  : '暫無資料';

const formatCandidates = (items: UsDailyStrategyCandidate[]) => items.length
  ? items.slice(0, 5).map((item, index) => {
      const trend = item.trend === 'up' ? '偏多' : '偏空';
      const badge = item.themeBadge ? `\n   └ ${escapeMrkdwn(item.themeBadge)}` : '';
      return `${index + 1}. *${escapeMrkdwn(item.symbol)}* · ${item.score} 分 · ${trend}\n   ${escapeMrkdwn(truncate(item.reason, 100))}${badge}`;
    }).join('\n')
  : '本輪沒有符合條件的候選';

export function createUsStockDailyCard(input: UsStockDailyCardInput): SlackPostPayload {
  const title = input.type === 'market' ? '📈 美股市場日報' : '🧭 美股 AI 三模式策略日報';
  const leader = input.topGainers[0];
  const active = input.mostActive[0];
  const blocks: Array<Record<string, unknown>> = [
    { type: 'header', text: { type: 'plain_text', text: `${title} · ${input.date}`, emoji: true } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: '美股已收盤公開行情｜Yahoo Finance｜僅供觀察' }] },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*🔥 漲幅焦點*\n${moverName(leader)}\n${leader ? percent(leader.changePercent) : '—'}` },
      { type: 'mrkdwn', text: `*📊 交投焦點*\n${moverName(active)}\n${active ? volume(active.volume) : '—'}` },
    ] },
  ];

  if (input.macro) {
    blocks.push(
      { type: 'section', text: { type: 'mrkdwn', text: `*🌍 總經風向 · ${escapeMrkdwn(input.macro.riskState)}*\n${escapeMrkdwn(truncate(input.macro.reason, 180))}` } },
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*美債 10Y*\n${escapeMrkdwn(input.macro.us10y)}` },
        { type: 'mrkdwn', text: `*美元指數 DXY*\n${escapeMrkdwn(input.macro.dxy)}` },
        { type: 'mrkdwn', text: `*VIX*\n${escapeMrkdwn(input.macro.vix)}` },
        { type: 'mrkdwn', text: `*10Y–3M 利差*\n${escapeMrkdwn(input.macro.yieldSpread)}` },
      ] },
    );
  }

  if (input.themeSummary) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*🎯 產業與 AI 題材風向*\n${escapeMrkdwn(input.themeSummary)}` },
    });
  }

  blocks.push({ type: 'divider' });
  if (input.type === 'market') {
    blocks.push(
      { type: 'section', fields: [
        { type: 'mrkdwn', text: `*🔥 漲幅領先 Top 5*\n${formatGainers(input.topGainers)}` },
        { type: 'mrkdwn', text: `*📊 交投活躍 Top 5*\n${formatActive(input.mostActive)}` },
      ] },
    );
  } else {
    for (const section of input.strategySections ?? []) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text:
        `*${escapeMrkdwn(section.title)}*  _${escapeMrkdwn(section.trendHint)}_\n${formatCandidates(section.candidates)}\n*AI 觀察*  ${escapeMrkdwn(truncate(section.insight, 180))}` } });
    }
  }

  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '⚠️ 投資有風險；排行反映當日行情，不代表後續報酬。' }] });
  return {
    text: `${title} ${input.date}｜漲幅焦點 ${leader?.symbol ?? '—'} ${leader ? percent(leader.changePercent) : ''}｜交投焦點 ${active?.symbol ?? '—'}`,
    blocks,
  };
}
