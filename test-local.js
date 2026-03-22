const test = async () => {
  try {
    const res = await fetch('http://localhost:3000/api/health');
    console.log(res.status);
    const data = await res.text();
    console.log(data);
  } catch (e) {
    console.error(e);
  }
};
test();
