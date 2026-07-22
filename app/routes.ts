import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("dashboard", "routes/dashboard.tsx"),
  route("stock-analysis", "routes/stock-analysis.tsx"),
  route("api/top50", "routes/api.top50.ts"),
  route("api/stock/*", "routes/api.stock.ts"),
  route("api/gemini", "routes/api.gemini.ts"),
  route("api/logout", "routes/api.logout.ts"),
  route("api/test-telegram", "routes/api.test-telegram.ts"),
  route("api/test-slack", "routes/api.test-slack.ts"),
  route("api/test-strategy", "routes/api.test-strategy.ts"),
  route("api/test-crypto", "routes/api.test-crypto.ts"),
  route("api/portfolio", "routes/api.portfolio.ts"),
  route("api/analyze-stock", "routes/api.analyze-stock.ts"),
  route("api/run-report", "routes/api.run-report.ts"),
  route("api/backtest", "routes/api.backtest.ts"),
  route("backtest", "routes/backtest.tsx"),
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  route("portfolio", "routes/portfolio.tsx"),
  route("settings", "routes/settings.tsx"),
] satisfies RouteConfig;
