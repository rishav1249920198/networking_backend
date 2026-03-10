const nodemailer = require("nodemailer")

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
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
