const axios = require("axios");

/**
 * Email Service using Brevo HTTP API
 * Render free tier blocks SMTP ports (25, 465, 587)
 * so we use Brevo's REST API over HTTPS instead.
 */

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

/**
 * Verify Brevo API key on startup
 */
const verifyEmailService = async () => {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!apiKey) {
    console.error(`❌ Email Service: BREVO_API_KEY not set in environment variables`);
    return false;
  }

  if (!fromEmail) {
    console.error(`❌ Email Service: SMTP_FROM not set in environment variables`);
    return false;
  }

  try {
    // Test the API key by fetching account info
    const res = await axios.get("https://api.brevo.com/v3/account", {
      headers: { "api-key": apiKey },
      timeout: 10000,
    });
    console.log(`✅ Email Service Ready (Brevo HTTP API)`);
    return true;
  } catch (error) {
    console.error(`❌ Email Service Failed: ${error.message}`);
    return false;
  }
};

/**
 * Send email via Brevo HTTP API
 */
const sendEmail = async (to, subject, html) => {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!apiKey) {
    throw new Error("BREVO_API_KEY is not configured");
  }

  try {
    const response = await axios.post(
      BREVO_API_URL,
      {
        sender: {
          name: "IGCIM Computer Centre",
          email: fromEmail,
        },
        to: [{ email: to }],
        subject: subject,
        htmlContent: html,
      },
      {
        headers: {
          "accept": "application/json",
          "content-type": "application/json",
          "api-key": apiKey,
        },
        timeout: 15000,
      }
    );

    return true;
  } catch (error) {
    console.error("\n❌ BREVO API DELIVERY FAILED");
    console.error("Status:", error.response?.status);
    console.error("Error:", error.response?.data?.message || error.message);
    console.error(`--- EMAIL ATTEMPT END ---\n`);

    throw error;
  }
};

module.exports = { sendEmail, verifyEmailService };
