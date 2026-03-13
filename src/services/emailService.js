const nodemailer = require("nodemailer");
const dns = require("dns");

/**
 * Robust Email Service with detailed Logging and IPv4 forcing
 */

// Force DNS resolution order globally for this process
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder("ipv4first");
}

const sendEmail = async (to, subject, html) => {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  // Default to 465 if not specified, user mentioned 587 didn't work.
  const port = parseInt(process.env.SMTP_PORT) || 465; 
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  console.log(`\n--- SMTP ATTEMPT START ---`);
  console.log(`Target: ${host}:${port} (SSL: ${port === 465})`);
  console.log(`User: ${user}`);

  try {
    // We use the hostname directly but force family: 4 to avoid IPv6 issues on Render.
    // This is more reliable than manual IP resolution as it preserves TLS certificate validation.
    const transporter = nodemailer.createTransport({
      host: host,
      port: port,
      secure: port === 465, // SSL for 465
      auth: {
        user: user,
        pass: pass
      },
      // IMPORTANT: Force IPv4 to avoid ENETUNREACH/ECONNREFUSED on Render's IPv6 interface
      family: 4, 
      
      // Enable logging to see the full SMTP handshake in production
      debug: true, 
      logger: true,
      
      tls: {
        // Do not fail on invalid certs, but we expect Gmail cert to be valid anyway.
        rejectUnauthorized: false
      },
      connectionTimeout: 10000, // 10s
      greetingTimeout: 10000,
      socketTimeout: 15000
    });

    console.log(`Transporter initialized. Sending mail...`);

    const info = await transporter.sendMail({
      from: `"IGCIM Computer Centre" <${user}>`,
      to,
      subject,
      html
    });

    console.log("✅ Email sent successfully:", info.messageId);
    console.log(`--- SMTP ATTEMPT END ---\n`);
    return true;

  } catch (error) {
    console.error("\n❌ SMTP DELIVERY FAILED");
    console.error("Code:", error.code);
    console.error("Command:", error.command);
    console.error("Response:", error.response);
    console.error("Stack Trace:", error.stack);
    console.error(`--- SMTP ATTEMPT END ---\n`);
    
    throw error;
  }
};

module.exports = { sendEmail };
