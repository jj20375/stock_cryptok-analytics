
import { runStockDailyStrategy } from './app/services/strategyEngine';
import * as dotenv from 'dotenv';

dotenv.config();

const env = {
  DB: {}, // Not used in runStockDailyStrategy
  SLACK_API_TOKEN: process.env.SLACK_API_TOKEN,
  SLACK_CHANNEL_ID: process.env.SLACK_CHANNEL_ID,
};

async function test() {
  console.log("🚀 Starting manual test for Daily Reports...");
  
  try {
    console.log("\n--- Testing TW Market Summary ---");
    await runStockDailyStrategy(env as any, "TW", "market");
    
    console.log("\n--- Testing US Market Summary ---");
    await runStockDailyStrategy(env as any, "US", "market");

    // Strategy scans take longer, test one of them
    console.log("\n--- Testing US Strategy Scan ---");
    await runStockDailyStrategy(env as any, "US", "strategy");

    console.log("\n✅ All tests finished.");
  } catch (err) {
    console.error("❌ Test failed:", err);
  }
}

test();
