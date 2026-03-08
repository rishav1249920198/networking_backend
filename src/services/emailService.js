const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 465,
  secure: parseInt(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false
  }
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

const sendTransactionalEmail = async (to, subject, html) => {
  if (!isSmtpConfigured()) {
    console.log(`\n📧 [NO SMTP] To: ${to} | Subject: ${subject}`);
    return { messageId: 'no-smtp' };
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_USER ? `IGCIM Computer Centre <${process.env.SMTP_USER}>` : 'noreply@igcim.com',
      to,
      subject,
      html,
    });
    return info;
  } catch (error) {
    console.error('Email sending failed:', error);
    throw error;
  }
};

module.exports = { sendTransactionalEmail };
