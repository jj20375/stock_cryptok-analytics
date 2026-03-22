const test = async () => {
  try {
    const res = await fetch('http://localhost:3000/api/stock/4919.TW?range=1d&interval=1m');
    console.log(res.status);
    const data = await res.json();
    console.log(data.chart.result[0].meta.regularMarketPrice);
  } catch (e) {
    console.error(e);
  }
};
test();
