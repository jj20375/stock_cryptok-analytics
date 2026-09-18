/** @file 共用導覽與版面；提供桌面及行動版雷達入口，不處理行情請求。 */
import type { ReactNode } from 'react';
import { Link, useLocation, useRouteLoaderData } from 'react-router';
import {
  Activity,
  LayoutGrid,
  List,
  Bell,
  Settings,
  User,
  TrendingUp,
  FlaskConical,
  Shield,
  Radar,
  Satellite
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const rootData = useRouteLoaderData<{ user: { email: string } | null }>("root");
  const user = rootData?.user;

  const isActive = (path: string) => {
    if (path === '/' && location.pathname === '/') return true;
    if (path !== '/' && location.pathname.startsWith(path)) return true;
    return false;
  };

  const navLinkClass = (path: string) => twMerge(
    clsx(
      "trading-nav-link p-2 transition-colors rounded-sm flex items-center justify-center",
      isActive(path) && "trading-nav-link-active",
    )
  );

  return (
    <div className="trading-shell min-h-screen font-sans pb-16 md:pb-0">
      {/* Sidebar Navigation - Desktop Only */}
      <aside className="trading-sidebar fixed left-0 top-0 h-full w-16 hidden md:flex flex-col items-center py-8 gap-8 z-20">
        <Link to="/" className="trading-logo w-10 h-10 rounded-sm flex items-center justify-center">
          <Activity size={24} />
        </Link>
        <nav className="flex flex-col gap-6 w-full px-2">
          <Link to="/dashboard" className={navLinkClass("/dashboard")} title="交易績效 Dashboard">
            <LayoutGrid size={20} />
          </Link>
          <Link to="/stock-analysis" className={navLinkClass("/stock-analysis")} title="個股深度分析">
            <TrendingUp size={20} />
          </Link>
          <Link to="/" className={navLinkClass("/")}>
            <Activity size={20} />
          </Link>
          <Link to="/portfolio" className={navLinkClass("/portfolio")} title="我的持股 Portfolio">
            <List size={20} />
          </Link>
          <Link to="/backtest" className={navLinkClass("/backtest")} title="策略回測 Backtest">
            <FlaskConical size={20} />
          </Link>
          <Link to="/warroom" className={navLinkClass('/warroom')} title="戰情室">
            <Shield size={20} />
          </Link>
          <Link to="/wave-radar" className={navLinkClass('/wave-radar')} title="波段雷達">
            <Bell size={20} />
          </Link>
          <Link to="/potential-radar" className={navLinkClass('/potential-radar')} title="潛力幣雷達" aria-label="潛力幣雷達">
            <Radar size={20} />
          </Link>
          <Link to="/us-stock-radar" className={navLinkClass('/us-stock-radar')} title="美股潛力雷達" aria-label="美股潛力雷達">
            <TrendingUp size={20} />
          </Link>
          <Link to="/tw-stock-radar" className={navLinkClass('/tw-stock-radar')} title="台股潛力雷達" aria-label="台股潛力雷達">
            <Radar size={20} />
          </Link>
          <Link to="/tradingview-signals" className={navLinkClass('/tradingview-signals')} title="TradingView 訊號績效" aria-label="TradingView 訊號績效">
            <Satellite size={20} />
          </Link>
        </nav>
        <div className="mt-auto flex flex-col gap-6 pb-4 w-full px-2 items-center">
          {user ? (
            <div className="flex flex-col items-center gap-4">
              <div 
                className="trading-logo w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm cursor-help"
                title={`登入身分：${user.email}`}
              >
                {user.email.substring(0, 2).toUpperCase()}
              </div>
              <Link to="/settings" className={navLinkClass("/settings")}>
                <Settings size={20} />
              </Link>
            </div>
          ) : (
            <>
              <Link to="/settings" className={navLinkClass("/settings")}>
                <Settings size={20} />
              </Link>
              <Link to="/login" className={navLinkClass("/login")}>
                <User size={20} />
              </Link>
            </>
          )}
        </div>
      </aside>

      {/* Mobile Bottom Navigation */}
      <nav className="trading-mobile-nav fixed bottom-0 left-0 w-full h-16 flex md:hidden items-center justify-around px-4 z-30">
        <Link to="/" className={navLinkClass("/")}>
          <Activity size={20} />
        </Link>
        <Link to="/stock-analysis" className={navLinkClass("/stock-analysis")}>
          <TrendingUp size={20} />
        </Link>
        <Link to="/dashboard" className={navLinkClass("/dashboard")}>
          <LayoutGrid size={20} />
        </Link>
        <Link to="/backtest" className={navLinkClass("/backtest")}>
          <FlaskConical size={20} />
        </Link>
        <Link to="/wave-radar" className={navLinkClass('/wave-radar')} title="波段雷達">
          <Bell size={20} />
        </Link>
        <Link to="/potential-radar" className={navLinkClass('/potential-radar')} title="潛力幣雷達" aria-label="潛力幣雷達">
          <Radar size={20} />
        </Link>
        <Link to="/us-stock-radar" className={navLinkClass('/us-stock-radar')} title="美股潛力雷達" aria-label="美股潛力雷達">
          <TrendingUp size={20} />
        </Link>
        <Link to="/tw-stock-radar" className={navLinkClass('/tw-stock-radar')} title="台股潛力雷達" aria-label="台股潛力雷達">
          <Radar size={20} />
        </Link>
        <Link to="/tradingview-signals" className={navLinkClass('/tradingview-signals')} title="TradingView 訊號績效" aria-label="TradingView 訊號績效">
          <Satellite size={20} />
        </Link>
        <Link to="/settings" className={navLinkClass("/settings")}>
          <Settings size={20} />
        </Link>
        {user ? (
          <div 
            className="trading-logo w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs"
            title={`登入身分：${user.email}`}
          >
            {user.email.substring(0, 2).toUpperCase()}
          </div>
        ) : (
          <Link to="/login" className={navLinkClass("/login")}>
            <User size={20} />
          </Link>
        )}
      </nav>

      {/* Main Content */}
      <main className="trading-main pl-0 md:pl-16 min-h-screen overflow-x-hidden overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
