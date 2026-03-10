const nodemailer = require('nodemailer');
require('dotenv').config();

console.log(`[EmailService] Initializing transporter with host: ${process.env.SMTP_HOST || 'smtp.gmail.com'}, port: 587, family: 4`);
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false
  },
  connectionTimeout: 15000, 
  greetingTimeout: 15000,
  socketTimeout: 20000,
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
