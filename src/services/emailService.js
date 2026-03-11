const nodemailer = require("nodemailer")

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_PORT == 465, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  // Force IPv4 as some environments (like Render) have IPv6 reachability issues with Gmail
  family: 4,
  tls: {
    // Do not fail on invalid certs
    rejectUnauthorized: false
  }
})

const sendEmail = async (to, subject, html) => {
  try {
    const info = await transporter.sendMail({
      from: `"IGCIM Computer Centre" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html
    })

    console.log("Email sent:", info.messageId)
    return info
  } catch(error) {
    console.error("SMTP EMAIL ERROR:", error)
    throw error
  }
}

module.exports = {
  sendEmail,
  sendTransactionalEmail: sendEmail
}
