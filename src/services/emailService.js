const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  tls: {
    rejectUnauthorized: false
  },
  family: 4,
  connectionTimeout: 20000,
  greetingTimeout: 20000,
  socketTimeout: 20000
});

const sendEmail = async (to, subject, html) => {
  try {
    console.log("Connecting to SMTP server...");

    const info = await transporter.sendMail({
      from: `"IGCIM Computer Centre" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html
    });

    console.log("Email sent successfully:", info.messageId);
    return true;

  } catch (error) {
    console.error("SMTP EMAIL ERROR:", error);
    throw error;
  }
};

module.exports = { sendEmail };
