const { Resend } = require("resend");

const sendEmail = async (to, subject, html) => {
  try {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY missing in environment variables");
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    const response = await resend.emails.send({
      from: "IGCIM Computer Centre <onboarding@resend.dev>",
      to: [to],
      subject: subject,
      html: html
    });

    console.log("Email sent:", response.id);
    return response;
  } catch (error) {
    console.error("Resend email error:", error);
    throw error;
  }
};

module.exports = {
  sendEmail,
  sendTransactionalEmail: sendEmail
};
