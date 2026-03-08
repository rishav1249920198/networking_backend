async function test() {
  try {
    const res = await fetch('http://localhost:5000/api/admissions/public', { method: 'POST' });
    const text = await res.text();
    console.log(res.status, text);
  } catch(e) {
    console.error(e.message);
  }
}
test();
