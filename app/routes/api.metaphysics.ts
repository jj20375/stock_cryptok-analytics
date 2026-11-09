/** @file GET /api/metaphysics?view=today｜narrative&kind=…：首頁小卡與 AI 解說用；只回傳登入者自己的資料。 */
import { loadMetaphysicsApi } from '../services/metaphysics/pageData.server';

export const loader = loadMetaphysicsApi;
