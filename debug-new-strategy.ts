
import { runStockDailyStrategy } from './app/services/strategyEngine';
import * as dotenv from 'dotenv';

dotenv.config();

const env = {
  DB: {},
  SLACK_API_TOKEN: process.env.SLACK_API_TOKEN,
  SLACK_CHANNEL_ID: process.env.SLACK_CHANNEL_ID,
};

async function test() {
  console.log("Starting manual test for new strategy...");
  try {
    await runStockDailyStrategy(env, "strategy");
    console.log("Strategy report finished.");
  } catch (err) {
    console.error("Test failed:", err);
  }
}

test();
