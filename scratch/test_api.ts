import { fetchStockFundamentals, fetchStockPeers } from './app/services/stockService';

async function test() {
  const symbol = '2330.TW';
  console.log(`Testing ${symbol}...`);
  
  const fundamentals = await fetchStockFundamentals(symbol);
  console.log('Fundamentals:', JSON.stringify(fundamentals, null, 2));
  
  const peers = await fetchStockPeers(symbol);
  console.log('Peers:', peers);
}

test().catch(console.error);
