const nodemailer = require("nodemailer");
const dns = require("dns");

/**
 * Robust Email Service with detailed Logging and Strict IPv4 forcing
 */

// Force DNS resolution order globally
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder("ipv4first");
}

const sendEmail = async (to, subject, html) => {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  // Default to 465 (SSL) but strongly recommend 587 (STARTTLS) for Render
  const port = parseInt(process.env.SMTP_PORT) || 465; 
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  console.log(`\n--- SMTP ATTEMPT START ---`);
  console.log(`Target: ${host}:${port} (SSL: ${port === 465})`);
  console.log(`Time: ${new Date().toISOString()}`);

  try {
    const transporter = nodemailer.createTransport({
      host: host,
      port: port,
      secure: port === 465, // SSL for 465, false for 587
      auth: {
        user: user,
        pass: pass
      },
      // Force IPv4 at the connection level
      family: 4, 
      
      // Force IPv4 at the DNS resolution level inside Nodemailer
      lookup: (hostname, options, callback) => {
        dns.lookup(hostname, { family: 4 }, (err, address, family) => {
          console.log(`[DNS DEBUG] Resolved ${hostname} to ${address} (v${family})`);
          callback(err, address, family);
        });
      },
      
      debug: true, 
      logger: true,
      
      tls: {
        rejectUnauthorized: false,
        // Ensure servername is set for certificate validation when using custom lookup
        servername: host
      },
      connectionTimeout: 20000, // Increased to 20s
      greetingTimeout: 20000,
      socketTimeout: 30000
    });

    console.log(`Transporter initialized. Mode: ${port === 465 ? 'SSL' : 'STARTTLS'}. Sending mail...`);

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
    console.error("Stage:", error.command || 'CONNECTION');
    console.error("Code:", error.code);
    console.error("Response:", error.response);
    if (error.code === 'ETIMEDOUT') {
      console.error("HELP: Connection timed out. This usually means Port " + port + " is blocked by Render's firewall or Gmail is throttling the IP.");
      console.error("FIX: Please change SMTP_PORT to 587 in your Render Dashboard.");
    }
    console.error(`--- SMTP ATTEMPT END ---\n`);
    
    throw error;
  }
};

module.exports = { sendEmail };
