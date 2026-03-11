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
    dns.lookup(hostname, { family: 4 }, (err, address) => {
      if (err) return reject(err);
      resolve(address);
    });
  });
};

const sendEmail = async (to, subject, html) => {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT) || 587;

  try {
    // Resolve host to IP to force IPv4 connection
    const ip = await resolveIpv4(host);
    console.log(`Connecting to SMTP server: ${host} (${ip}) on port ${port}...`);

    const transporter = nodemailer.createTransport({
      host: ip, // Use the resolved IP address directly
      port: port,
      secure: false, // port 587 uses STARTTLS
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      tls: {
        servername: host, // Crucial: Must match host for certificate validation
        rejectUnauthorized: false
      },
      connectionTimeout: 60000,
      greetingTimeout: 60000,
      socketTimeout: 60000
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
    throw error;
  }
};

module.exports = { sendEmail };
