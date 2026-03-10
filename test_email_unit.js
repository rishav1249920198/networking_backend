const { sendEmail } = require('./src/services/emailService');
const assert = require('assert');

// Mock Resend
const mockResend = {
  emails: {
    send: async (data) => {
      console.log('Mocked Resend sending:', data);
      return { id: 'mock_id' };
    }
  }
};

// Override Resend in the service for testing
// This is a bit hacky but works for verification if we can't use a proper mocking lib
const originalResend = require('resend').Resend;
require('resend').Resend = function() { return mockResend; };

async function runTest() {
  process.env.RESEND_API_KEY = 'test_key';
  try {
    const result = await sendEmail('test@example.com', 'Test Subject', '<p>Hello</p>');
    assert.strictEqual(result.id, 'mock_id');
    console.log('✅ Unit test passed: sendEmail works with mocked Resend');
  } catch (error) {
    console.error('❌ Unit test failed:', error);
    process.exit(1);
  } finally {
    require('resend').Resend = originalResend;
  }
}

runTest();
