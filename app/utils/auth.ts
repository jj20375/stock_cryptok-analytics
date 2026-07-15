// 【詳細繁體中文註解】：身份驗證模組
// 負責密碼的雜湊 (PBKDF2) 以及 React Router 的 Session 管理

import { createCookieSessionStorage } from "react-router";

/**
 * 產生隨機鹽 (Salt)
 */
function generateSalt(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 使用 PBKDF2 進行密碼雜湊
 * @param password 使用者輸入的明文密碼
 * @param salt 鹽值
 */
async function hashWithSalt(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );

  const saltBuffer = enc.encode(salt);
  
  // 執行 100,000 次疊代，提升暴力破解難度
  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    256 // 輸出 256 bits (32 bytes) 的長度
  );

  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  // 儲存格式：salt:hash
  return `${salt}:${hashHex}`;
}

/**
 * 雜湊密碼（用於註冊時儲存入資料庫）
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = generateSalt();
  return hashWithSalt(password, salt);
}

/**
 * 驗證密碼（用於登入時比對）
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, originalHash] = storedHash.split(':');
  if (!salt || !originalHash) return false;
  
  const attemptHash = await hashWithSalt(password, salt);
  return attemptHash === storedHash;
}

// ==========================================
// Session 管理 (登入狀態) - 改為動態取得環境變數以防偽造
// ==========================================

let _sessionStorage: any = null;

/**
 * 【詳細繁體中文註解】：動態初始化 Session Cookie Storage 實例
 * 避免將 Session 簽名金鑰 (secret) 寫死在原始碼中。若未設定環境變數，系統將印出警告並提供安全後備。
 * @param env 來自 Cloudflare Context 或 Process 的環境變數物件
 */
function getSessionStorage(env: any) {
  if (_sessionStorage) return _sessionStorage;

  // 優先從 Cloudflare worker env 讀取，其次從 node process.env 讀取
  const secret = env?.SESSION_SECRET || (typeof process !== "undefined" ? process.env?.SESSION_SECRET : null) || "s3cr3t_auth_k3y_for_s3ssion";

  if (!env?.SESSION_SECRET && (typeof process === "undefined" || !process.env?.SESSION_SECRET)) {
    console.warn("⚠️ [Security Warning] 未設定環境變數 SESSION_SECRET，正在使用預設簽名密鑰！這在生產環境極度危險！");
  }

  _sessionStorage = createCookieSessionStorage({
    cookie: {
      name: "__crypto_session",
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secrets: [secret],
      secure: true, // 在生產環境與 localhost HTTPS 皆可運作
      maxAge: 60 * 60 * 24 * 7, // Session 存活 7 天
    },
  });
  return _sessionStorage;
}

export async function getSession(request: Request, env: any) {
  const cookie = request.headers.get("Cookie");
  return getSessionStorage(env).getSession(cookie);
}

export async function commitSession(session: any, env: any) {
  return getSessionStorage(env).commitSession(session);
}

export async function destroySession(session: any, env: any) {
  return getSessionStorage(env).destroySession(session);
}

/**
 * 取得當前登入使用者的 ID，如果未登入則回傳 null
 */
export async function getUserId(request: Request, env: any): Promise<number | null> {
  const session = await getSession(request, env);
  const userId = session.get("userId");
  if (!userId) return null;
  return Number(userId);
}
