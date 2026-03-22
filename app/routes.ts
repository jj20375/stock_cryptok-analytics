import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/top50", "routes/api.top50.ts"),
  route("api/stock/*", "routes/api.stock.ts"),
  route("api/gemini", "routes/api.gemini.ts"),
] satisfies RouteConfig;
