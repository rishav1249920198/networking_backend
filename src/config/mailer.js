const { sendEmail } = require('../services/emailService');

const sendMail = async ({ to, subject, html }) => {
  return await sendEmail(to, subject, html);
};

module.exports = { sendMail };
