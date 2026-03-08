const { Resend } = require('resend');
require('dotenv').config();

const resend = new Resend(process.env.RESEND_API_KEY);

const sendEmail = async (to, subject, html) => {
  await resend.emails.send({
    from: "IGCIM <onboarding@resend.dev>",
    to,
    subject,
    html
  });
};

// Aliased to prevent breaking other files that use sendTransactionalEmail
module.exports = { sendEmail, sendTransactionalEmail: sendEmail };
