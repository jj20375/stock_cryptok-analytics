import React from 'react';
import { Link, useLocation, useRouteLoaderData } from 'react-router';
import {
  Activity,
  LayoutGrid,
  List,
  Bell,
  Settings,
  User,
  TrendingUp,
  FlaskConical
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function AppLayout({ children }: { children: React.ReactNode }) {
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
      "p-2 transition-colors rounded-sm flex items-center justify-center",
      isActive(path) 
        ? "bg-[#141414] text-[#E4E3E0]" 
        : "hover:bg-[#141414] hover:text-[#E4E3E0]"
    )
  );

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0] pb-16 md:pb-0">
      {/* Sidebar Navigation - Desktop Only */}
      <aside className="fixed left-0 top-0 h-full w-16 border-r border-[#141414] hidden md:flex flex-col items-center py-8 gap-8 bg-[#E4E3E0] z-20">
        <Link to="/" className="w-10 h-10 bg-[#141414] rounded-sm flex items-center justify-center text-[#E4E3E0]">
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
          <button className="p-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors rounded-sm flex justify-center">
            <Bell size={20} />
          </button>
        </nav>
        <div className="mt-auto flex flex-col gap-6 pb-4 w-full px-2 items-center">
          {user ? (
            <div className="flex flex-col items-center gap-4">
              <div 
                className="w-10 h-10 bg-[#141414] text-[#E4E3E0] rounded-full flex items-center justify-center font-bold text-sm cursor-help"
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
      <nav className="fixed bottom-0 left-0 w-full h-16 bg-[#E4E3E0] border-t border-[#141414] flex md:hidden items-center justify-around px-4 z-30">
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
        <Link to="/settings" className={navLinkClass("/settings")}>
          <Settings size={20} />
        </Link>
        {user ? (
          <div 
            className="w-8 h-8 bg-[#141414] text-[#E4E3E0] rounded-full flex items-center justify-center font-bold text-xs"
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
      <main className="pl-0 md:pl-16 min-h-screen overflow-x-hidden overflow-y-auto bg-[#E4E3E0]">
        {children}
      </main>
    </div>
  );
}
