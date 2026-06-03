async function test() {
  const symbol = '2330.TW';
  console.log(`Testing ${symbol} fundamentals...`);
  
  const fundUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=summaryDetail,defaultKeyStatistics,assetProfile`;
  const fundRes = await fetch(fundUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
  console.log('Fund Status:', fundRes.status);
  const fundData = await fundRes.json();
  console.log('Fund Data:', JSON.stringify(fundData, null, 2));

  console.log(`\nTesting ${symbol} peers...`);
  const peerUrl = `https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/${symbol}`;
  const peerRes = await fetch(peerUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
  console.log('Peer Status:', peerRes.status);
  const peerData = await peerRes.json();
  console.log('Peer Data:', JSON.stringify(peerData, null, 2));
}

test().catch(console.error);
