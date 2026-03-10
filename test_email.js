const { sendEmail } = require('./src/services/emailService');
require('dotenv').config();

async function test() {
  console.log('Starting email test...');
  try {
    await sendEmail(process.env.SMTP_USER, 'Test Email from IGCIM', '<h1>Test Success</h1><p>The email service is working correctly.</p>');
    console.log('✅ Test email sent successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Test email failed:', err);
    process.exit(1);
  }
}

test();
