const fs = require('fs');

async function test() {
  const formData = new FormData();
  formData.append('student_name', 'Test User');
  formData.append('student_mobile', '1234567890');
  formData.append('student_email', 'test@test.com');
  formData.append('address', '123 Test St');
  formData.append('course_id', 'some-id');
  formData.append('payment_mode', 'cash');

  try {
    const res = await fetch('http://localhost:5000/api/admissions/public', {
      method: 'POST',
      body: formData
    });
    const text = await res.text();
    console.log(res.status, text);
  } catch(e) {
    console.error(e.message);
  }
}
test();
