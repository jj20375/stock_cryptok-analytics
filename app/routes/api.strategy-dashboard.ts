/** @file 即時戰略 Dashboard API：只負責 request／response，彙整邏輯在 services/strategyDashboard；唯讀、不推播、不下單。 */
import type { LoaderFunctionArgs } from 'react-router';
import { strategyDashboardResponse } from '../services/strategyDashboard/loader.server';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as { cloudflare: { env: Record<string, any> } }).cloudflare.env;
  return strategyDashboardResponse(request, env);
}
