// 【詳細繁體中文註解】：加密模組，使用 Web Crypto API 的 AES-GCM 演算法
// 負責安全地將敏感資料（如 Telegram Token, API 金鑰）加密儲存至資料庫

/**
 * 將 Base64 字串轉回 Uint8Array
 */
function base64ToArrayBuffer(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * 將 Uint8Array 轉換為 Base64 字串
 */
function arrayBufferToBase64(buffer: Uint8Array): string {
  let binary = '';
  const len = buffer.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

/**
 * 將系統主加密金鑰轉換為 CryptoKey 物件
 */
async function getPasswordKey(masterKey: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  // 注意：實際環境中 masterKey 長度應該固定且足夠長，此處使用 SHA-256 對 masterKey 進行雜湊，以確保轉換為正確長度的 key material
  const keyMaterial = await crypto.subtle.digest("SHA-256", enc.encode(masterKey));
  return crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * 加密文字
 * @param text 要加密的明文 (例如 API Key)
 * @param masterKey 系統主加密金鑰 (來自環境變數)
 * @returns 回傳 base64 編碼的 IV + 加密資料字串
 */
export async function encryptData(text: string, masterKey: string): Promise<string> {
  if (!text) return text;
  
  const key = await getPasswordKey(masterKey);
  const enc = new TextEncoder();
  const encoded = enc.encode(text);

  // 隨機產生 12 bytes 的 Initialization Vector (IV)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // 執行 AES-GCM 加密
  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    encoded
  );

  // 將 IV 與 加密後的資料合併，並轉為 Base64 字串方便儲存在 SQLite
  const cipherArray = new Uint8Array(cipherBuffer);
  const combined = new Uint8Array(iv.length + cipherArray.length);
  combined.set(iv, 0);
  combined.set(cipherArray, iv.length);

  return arrayBufferToBase64(combined);
}

/**
 * 解密文字
 * @param encryptedText base64 編碼的加密資料字串 (從資料庫讀出)
 * @param masterKey 系統主加密金鑰 (來自環境變數)
 * @returns 解密後的明文
 */
export async function decryptData(encryptedText: string, masterKey: string): Promise<string> {
  if (!encryptedText) return encryptedText;

  try {
    const key = await getPasswordKey(masterKey);
    const combined = base64ToArrayBuffer(encryptedText);

    // 提取出前 12 bytes 的 IV 與後續的加密資料
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);

    // 執行 AES-GCM 解密
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      key,
      data
    );

    const dec = new TextDecoder();
    return dec.decode(decryptedBuffer);
  } catch (error) {
    console.error("解密失敗", error);
    throw new Error("無法解密資料，請確認系統主加密金鑰是否正確。");
  }
}
