const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false
  },
  connectionTimeout: 10000, 
  greetingTimeout: 10000,
  socketTimeout: 15000,
  // Force IPv4 to avoid ENETUNREACH on IPv6-enabled environments
  family: 4 
});

const sendEmail = async (to, subject, html) => {
  console.log(`[EmailService] Attempting to send email to: ${to}, Subject: ${subject}`);
  try {
    const info = await transporter.sendMail({
      from: `"IGCIM Computer Centre" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html
    });
    console.log(`[EmailService] Email sent successfully: ${info.messageId}`);
  } catch (error) {
    console.error(`[EmailService] Failed to send email to ${to}:`, error);
    throw error;
  }
};

module.exports = { sendEmail, sendTransactionalEmail: sendEmail };
