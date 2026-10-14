/** @file Vite 本機資料與可選的 Demo 排程；Demo 啟動旗標不寫入正式 Worker。 */
import tailwindcss from '@tailwindcss/vite';
import { reactRouter } from "@react-router/dev/vite";
import { cloudflareDevProxy } from "@react-router/dev/vite/cloudflare";
import path from 'path';
import {defineConfig} from 'vite';
import { createLocalRadars } from './dev/localRadars';
import { velaDatesPlugins } from './dev/velaDates';
import { createLocalFuturesDemo } from './dev/localFuturesDemo';

export default defineConfig(() => {
  const localRadars = createLocalRadars();
  const localDemo = createLocalFuturesDemo(process.env.LOCAL_BITGET_DEMO === 'true', process.env.LOCAL_BITGET_LIVE === 'true');
  const velaDates = velaDatesPlugins();
  return {
    plugins: [velaDates.vite, cloudflareDevProxy({ getLoadContext({ context }) {
      /** Vite 不會觸發 Worker scheduled；兩個本機排程共用本機 D1，Demo 須以專用指令開放。 */
      const env = localDemo.environment(context.cloudflare.env as Record<string, unknown>);
      localRadars.start(env);
      localDemo.start(env);
      return { ...context, cloudflare: { ...context.cloudflare, env } };
    } }), localRadars.plugin, localDemo.plugin, reactRouter(), tailwindcss()],
    optimizeDeps: { esbuildOptions: { plugins: [velaDates.esbuild] } },
    // 金鑰由伺服器執行時的環境變數提供，不能在建置時把本機金鑰寫入程式包。
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
