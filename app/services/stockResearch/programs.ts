/** @file 從免登入首頁擷取公開節目標題，不讀取影片、字幕或會員圖卡。 */
import type { MentionedStock, ProgramTopic } from './types';

/** 僅按標題中的明確關鍵字分類，分類不等於產業成長或公司受惠證據。 */
const themeKeywords: [string, RegExp][] = [
  ['AI／資料中心', /\bAI\b|人工智慧|資料中心|伺服器|輝達|GB\d{3}/i],
  ['半導體', /半導體|晶圓|先進製程|封裝|CoWoS|測試產能/i],
  ['記憶體', /記憶體|DRAM|NAND|HBM/i],
  ['PCB／電子材料', /PCB|TPCA|載板|玻纖|銅箔|電子材料|PTFE/i],
  ['光通訊', /光通訊|矽光子|CPO/i],
  ['散熱／電力', /散熱|液冷|電力|重電|電源|電網/],
  ['連接器', /連接器|連接線|高速傳輸/],
  ['面板', /面板|雙虎/],
  ['航運', /航運|貨櫃|運價/],
  ['利率／匯率', /利率|降息|升息|公債|匯率|新台幣|美元/],
  ['黃金／原物料', /黃金|金價|原油|油價|原物料/],
];

/** 只解碼文字實體；輸出由 React 當文字顯示，不注入第三方 HTML。 */
function decodeText(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, key: string) => {
    const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
    if (!key.startsWith('#')) return named[key.toLowerCase()] ?? entity;
    const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  }).replace(/[\u0000-\u001f]/g, ' ').trim();
}

function dateFromTitle(title: string): string | null {
  const match = title.match(/(?:^|\D)(20\d{2})(\d{2})(\d{2})(?!\d)/);
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  const stamp = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().startsWith(iso) ? iso : null;
}

function titleMentions(title: string, stock: MentionedStock): boolean {
  const name = stock.name.replace(/\*$/, '');
  if (new RegExp(`[（(]${stock.code}[)）]`).test(title)) return true;
  if (name.length >= 3) return title.toLowerCase().includes(name.toLowerCase());
  /** 「世界」等兩字簡稱容易撞到一般用語，只接受分隔明確的名稱，寧可漏列也不亂配概念股。 */
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return name.length >= 2 && new RegExp(`(?:^|[\\s、，,:：《「【])${escaped}(?=$|[\\s、，,.。!！?？:：》」】])`).test(title);
}

export function parsePublicPrograms(html: string, stocks: MentionedStock[], now = Date.now()): ProgramTopic[] {
  const programs: ProgramTopic[] = [];
  const seen = new Set<string>();
  /** 以 Asia/Taipei 的當日作日期界線；沒有日期、未來節目或超過 14 天的內容不冒充近期線索。 */
  const today = new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
  const todayStamp = Date.parse(`${today}T00:00:00Z`);
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const attr of match[0].matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/gs)) attrs.set(attr[1].toLowerCase(), decodeText(attr[3]));
    if (attrs.get('data-program') !== '28') continue;
    const title = attrs.get('data-subject') ?? '', id = attrs.get('data-youtube') ?? '';
    if (!/^[\w-]{11}$/.test(id) || !title || title.length > 300 || /完整版/.test(title)) continue;
    const programDate = dateFromTitle(title);
    if (!programDate) continue;
    const age = todayStamp - Date.parse(`${programDate}T00:00:00Z`);
    if (age < 0 || age > 14 * 86_400_000) continue;
    const dedupKey = `${programDate}:${title.replace(/20\d{6}-\d+/g, '').replace(/\s/g, '')}`;
    if (seen.has(id) || seen.has(dedupKey)) continue;
    seen.add(id); seen.add(dedupKey);
    programs.push({ id, title, programDate, url: `https://news.ustv.com.tw/program/28/${id}`,
      videoUrl: `https://www.youtube.com/watch?v=${id}`,
      themes: themeKeywords.filter(([, pattern]) => pattern.test(title)).map(([theme]) => theme),
      stocks: stocks.filter(stock => titleMentions(title, stock)).slice(0, 12) });
  }
  return programs.sort((a, b) => b.programDate.localeCompare(a.programDate)).slice(0, 20);
}
