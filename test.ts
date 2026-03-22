async function test() {
  const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/SOL-USD?range=1d&interval=1m');
  const data = await res.json();
  console.log(data.chart.result[0].meta.longName || data.chart.result[0].meta.shortName);
}
test();
