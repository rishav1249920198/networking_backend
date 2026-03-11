const nodemailer = require("nodemailer");
const dns = require("dns");

// Force IPv4 resolution globally
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder("ipv4first");
}

/**
 * Manually resolve hostname to IPv4 address
 */
const resolveIpv4 = (hostname) => {
  return new Promise((resolve, reject) => {
    // Try multiple times if needed, or use a specific timeout
    dns.lookup(hostname, { family: 4 }, (err, address) => {
      if (err) return reject(err);
      resolve(address);
    });
  });
};

const sendEmail = async (to, subject, html) => {
  // Use Port 465 (SSL) as it's often more stable on cloud platforms
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT) || 465; 

  try {
    // Resolve host to IP to force IPv4 connection
    const ip = await resolveIpv4(host);
    console.log(`Connecting to SMTP server: ${host} (${ip}) on port ${port} (SSL: ${port === 465})...`);

    const transporter = nodemailer.createTransport({
      host: ip, 
      port: port,
      secure: port === 465, // Use SSL for port 465
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      tls: {
        servername: host, // Verify certificate against original hostname
        rejectUnauthorized: false
      },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 20000
    });

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
    // If 465 fails, we could potentially fallback to 587, but usually if one times out, 
    // it's an IP block or config issue.
    throw error;
  }
};

module.exports = { sendEmail };
