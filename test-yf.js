const test = async () => {
  try {
    const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/4919.TW?range=1d&interval=1d', {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });
    console.log(res.status);
    const data = await res.json();
    console.log(data.chart.result[0].meta.regularMarketPrice);
  } catch (e) {
    console.error(e);
  }
};
test();
