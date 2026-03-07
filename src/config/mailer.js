

const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Detect unconfigured/placeholder SMTP credentials
const isSmtpConfigured = () => {
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  return user.length > 0
    && !user.includes('your_email')
    && !user.includes('example')
    && pass.length > 0
    && !pass.includes('your_app_password');
};

const sendMail = async ({ to, subject, html }) => {
  // Only fall back to console if SMTP is not configured
  if (!isSmtpConfigured()) {
    console.log(`\n📧 [NO SMTP] To: ${to} | Subject: ${subject}`);
    return { messageId: 'no-smtp' };
  }

  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'IGCIM <noreply@igcim.com>',
    to,
    subject,
    html,
  });
  return info;
};

module.exports = { sendMail };
