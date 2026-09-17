/** @file 本機開發雷達更新：使用 Vite 的本機 D1，僅掃描行情；不呼叫交易引擎、不建立或發送通知。 */
import type { Plugin, ViteDevServer } from 'vite';

export function createLocalRadars() {
  let server: ViteDevServer | undefined;
  let env: Record<string, unknown> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  /** 兩個觀察雷達各自防重疊，波段行情緩慢時不阻塞潛力幣更新。 */
  let waveRunning = false;
  let potentialRunning = false;
  let stopped = false;

  const scanWave = async () => {
    if (waveRunning || stopped || !env || !server) return;
    waveRunning = true;
    try {
      const wave = await server.ssrLoadModule('/app/services/waveRadar/scanner.ts');
      /** 每分鐘最多 12 檔補齊波段覆蓋；同一根成功行情由掃描器略過，避免重抓。 */
      await wave.runWaveRadar({ DB: env.DB, WAVE_RADAR_ENABLED: env.WAVE_RADAR_ENABLED }, { notifications: false });
    } catch {
      console.error('[Local Radar] 本機波段更新失敗，請確認本機 D1 migrations 與公開行情連線');
    } finally { waveRunning = false; }
  };

  const scanPotential = async () => {
    if (potentialRunning || stopped || !env || !server || Date.now() % 900_000 < 120_000) return;
    potentialRunning = true;
    try {
      /** 每分鐘載入目前版本；成功去重由掃描器處理，避免熱更新後仍被舊的時間格快取擋住。 */
      const potential = await server.ssrLoadModule('/app/services/potentialRadar/scanner.ts');
      await potential.runPotentialRadar({ DB: env.DB, POTENTIAL_RADAR_ENABLED: env.POTENTIAL_RADAR_ENABLED });
    } catch {
      console.error('[Local Radar] 本機潛力幣更新失敗，下一分鐘重試');
    } finally { potentialRunning = false; }
  };

  const tick = () => {
    /** 本機只啟動既有觀察掃描；各自捕捉錯誤，不讓單一來源故障中斷另一個雷達。 */
    void scanPotential();
    void scanWave();
  };

  const plugin: Plugin = {
    name: 'local-observation-radars',
    apply: 'serve',
    configureServer(viteServer) {
      server = viteServer;
      viteServer.httpServer?.once('close', () => {
        stopped = true;
        if (timer) clearInterval(timer);
      });
    },
  };

  return { plugin, start(localEnv: Record<string, unknown>) {
    if (timer || stopped) return;
    env = localEnv;
    timer = setInterval(() => void tick(), 60_000);
    timer.unref();
    void tick();
  } };
}
