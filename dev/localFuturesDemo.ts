/** @file 本機合約排程；Demo 指令只放行模擬環境，正式指令仍須本人 LIVE 設定與表單授權。 */
import type { Plugin, ViteDevServer } from 'vite';

export function createLocalFuturesDemo(enabled: boolean, liveEnabled = false) {
  let server: ViteDevServer | undefined;
  let env: Record<string, unknown> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let stopped = false;
  /** 五分鐘保護與對帳分開於每分鐘訊號；啟動後先檢查既有自動化 Demo 部位。 */
  let protectedAt = 0;

  const tick = async () => {
    if (!enabled || running || stopped || !server || !env) return;
    running = true;
    try {
      if (Date.now() - protectedAt >= 300_000) {
        protectedAt = Date.now();
        try {
          const protection = await server.ssrLoadModule('/app/services/cryptoAutoTrading/stopMonitor.ts');
          /** 只管理啟動指令所選環境與本來源；Demo 指令不解密或操作正式盤。 */
          for (const mode of liveEnabled ? ['DEMO', 'LIVE'] : ['DEMO']) {
            if (stopped) return;
            await protection.runCryptoFuturesStopMonitor(env, { mode, source: 'FUTURES_AUTO' });
          }
        } catch { console.warn('[Local Demo] 持倉保護未完成，下輪重試'); }
        if (stopped) return;
        try {
          const ledger = await server.ssrLoadModule('/app/services/bitgetLedger/sync.server.ts');
          for (const mode of liveEnabled ? ['DEMO', 'LIVE'] : ['DEMO']) {
            if (stopped) return;
            await ledger.syncRegisteredLedgers(env, mode);
          }
        } catch { console.warn('[Local Demo] 成交對帳未完成，下輪重試'); }
      }
      if (stopped) return;
      const automation = await server.ssrLoadModule('/app/services/cryptoFutures/automation.server.ts');
      /** 真正的模擬委託與 Slack 發送由既有引擎控制；停用帳戶不會建立新倉。 */
      await automation.runFuturesAutomation(env, liveEnabled ? undefined : 'DEMO');
    } catch { console.warn('[Local Demo] 本輪未完成，請查看合約頁最近檢查原因'); }
    finally { running = false; }
  };

  const plugin: Plugin = {
    name: 'local-bitget-demo-automation',
    apply: 'serve',
    configureServer(viteServer) {
      server = viteServer;
      viteServer.httpServer?.once('close', () => {
        stopped = true;
        if (timer) clearInterval(timer);
      });
    },
  };
  return {
    plugin,
    environment(localEnv: Record<string, unknown>) {
      if (!enabled) return localEnv;
      /** 只覆寫本機請求上下文，保留 Cloudflare 部署開關；舊掃描與新倉政策維持關閉。 */
      return { ...localEnv, CRYPTO_FUTURES_DEMO_AUTOMATION_ENABLED: 'true', CRYPTO_FUTURES_DEMO_AUTOMATION_PAUSE_REASON: '',
        /** 此旗標只開放環境；本機資料庫舊 Demo 設定不會升級成 LIVE。 */
        CRYPTO_FUTURES_LIVE_AUTOMATION_ENABLED: liveEnabled ? 'true' : 'false',
        CRYPTO_FUTURES_LIVE_AUTOMATION_PAUSE_REASON: liveEnabled ? '' : '目前是 Demo 執行器；正式自動化需自行使用 npm run dev:trading 啟動，再完成帳戶 LIVE 授權',
        CRYPTO_NEW_ENTRIES_ENABLED: 'false', CRYPTO_AUTO_SCAN_ENABLED: 'false', WAVE_RADAR_ENABLED: 'false', POTENTIAL_RADAR_ENABLED: 'false' };
    },
    start(localEnv: Record<string, unknown>) {
      if (!enabled || timer || stopped) return;
      if (!localEnv.SESSION_SECRET || !localEnv.MASTER_ENCRYPTION_KEY) {
        console.warn('[Local Demo] .dev.vars 尚缺 SESSION_SECRET 或 MASTER_ENCRYPTION_KEY，未啟動排程');
        return;
      }
      env = localEnv;
      console.info(`[Local Futures] 每分鐘排程已啟動；本機 D1，環境 ${liveEnabled ? 'DEMO／LIVE' : 'DEMO'}，帳戶須另行授權`);
      timer = setInterval(() => void tick(), 60_000);
      timer.unref();
      void tick();
    },
  };
}
