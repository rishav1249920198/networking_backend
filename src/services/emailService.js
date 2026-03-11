const nodemailer = require("nodemailer");
const dns = require("dns");

// Force IPv4 resolution to avoid Render IPv6 SMTP issues
dns.setDefaultResultOrder("ipv4first");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  family: 4,
  // Force IPv4 lookup
  lookup: (hostname, options, callback) => {
    dns.lookup(hostname, { family: 4 }, callback);
  },

  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },

  tls: {
    rejectUnauthorized: false
  },

  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000
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
