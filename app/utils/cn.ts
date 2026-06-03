import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 【詳細繁體中文註解】：Tailwind CSS 類名合併工具
 * 結合了 clsx (處理條件類名) 與 twMerge (處理 Tailwind 類名衝突)
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
