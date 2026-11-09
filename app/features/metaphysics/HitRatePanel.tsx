/** @component 命中率：各市場回測與上線後快照的變盤／方向命中率，並列基準機率與 95% 區間。 */
import type { RateStat } from '../../services/metaphysics/hitRate';
import type { MarketCalendar } from '../../services/metaphysics/pageData.server';

const formatRate = (stat: RateStat) => (stat.rate == null ? '資料不足'
  : `${(stat.rate * 100).toFixed(1)}%（${stat.hits}/${stat.total}，${(stat.low! * 100).toFixed(1)}–${(stat.high! * 100).toFixed(1)}%）`);

export function HitRatePanel({ markets }: { markets: MarketCalendar[] }) {
  return (
    <section className="space-y-4">
      <p className="text-sm opacity-75">
        「變盤」指當日漲跌幅 ≥ 前 20 日平均的 1.5 倍，或連三日同向後反轉；變盤命中率只看強度 ≥ 2 的日子，方向命中率只看 |分數| ≥ 30 的日子。
        玄學命中率的 95% 區間必須與基準不重疊，才算與隨機有差異。
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead><tr className="border-b border-current/20">
            <th className="py-2">市場</th><th>來源</th><th>變盤命中率</th><th>變盤基準</th><th>方向命中率</th><th>方向基準（一直猜漲）</th><th>判讀</th>
          </tr></thead>
          <tbody>
            {markets.flatMap((m) => (['backtest', 'live'] as const).map((source) => {
              const s = m.hitRate[source];
              const verdict = s.turning.total === 0 ? '資料不足'
                : s.turningDistinguishable || s.directionDistinguishable ? '與隨機有差異' : '與隨機無明顯差異';
              return (
                <tr key={`${m.market}-${source}`} className="border-b border-current/10">
                  <td className="py-2">{m.label}</td><td>{source === 'backtest' ? '歷史回測' : '上線後快照'}</td>
                  <td>{formatRate(s.turning)}</td><td>{formatRate(s.turningBaseline)}</td>
                  <td>{formatRate(s.direction)}</td><td>{formatRate(s.directionBaseline)}</td><td>{verdict}</td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>
      <p className="text-xs opacity-60">規則版本 ziwei-v1；回測資料由 scripts/metaphysics/backtest-ziwei-timing.ts 產生後匯入。</p>
    </section>
  );
}
