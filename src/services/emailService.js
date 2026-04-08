const nodemailer = require("nodemailer");

/**
 * Email Service using Brevo SMTP
 * For local development
 */

// Create a reusable transporter
let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST || "smtp-relay.brevo.com";
  const port = parseInt(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  transporter = nodemailer.createTransport({
    host: host,
    port: port,
    secure: port === 465,
    auth: {
      user: user,
      pass: pass
    },
    tls: {
      rejectUnauthorized: false,
      servername: host
    },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000
  });

  return transporter;
};

/**
 * Verify SMTP connection on startup
 * Logs success/failure to the terminal
 */
const verifyEmailService = async () => {
  const host = process.env.SMTP_HOST || "smtp-relay.brevo.com";
  const port = parseInt(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const fromEmail = process.env.SMTP_FROM || user;

  if (!user || !pass) {
    console.error(`❌ Email Service Mising Credentials! Set SMTP_USER and SMTP_PASS in .env`);
    return false;
  }

  try {
    const t = getTransporter();
    await t.verify();
    console.log(`✅ Email Service Ready`);
    return true;
  } catch (error) {
    console.error(`❌ Email Service Failed to Connect: ${error.message}`);
    return false;
  }
};

const sendEmail = async (to, subject, html) => {
  // SMTP_FROM = verified sender email in Brevo
  // SMTP_USER = Brevo login (just for authentication, NOT the sender)
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;

  try {
    const t = getTransporter();

    const info = await t.sendMail({
      from: `"IGCIM Computer Centre" <${fromEmail}>`,
      to,
      subject,
      html
    });

    return true;

  } catch (error) {
    console.error("\n❌ SMTP DELIVERY FAILED");
    console.error("Stage:", error.command || 'CONNECTION');
    console.error("Code:", error.code);
    console.error("Response:", error.response);
    console.error("Message:", error.message);
    console.error(`--- SMTP ATTEMPT END ---\n`);
    
    throw error;
  }
};

module.exports = { sendEmail, verifyEmailService };
