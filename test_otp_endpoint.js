const axios = require('axios');

async function testOTP() {
  try {
    const response = await axios.post('http://localhost:5000/api/admissions/request-otp', {
      name: 'Test student',
      email: 'rishav1249920198@gmail.com', // Using a real email to check delivery if possible
      mobile: '1234567890',
      course: 'Test Course'
    });
    console.log('OTP Response:', response.data);
  } catch (error) {
    if (error.response) {
      console.error('OTP Error Body:', error.response.data);
    } else {
      console.error('OTP Error:', error.message);
    }
  }
}

testOTP();
