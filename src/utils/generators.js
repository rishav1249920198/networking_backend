const crypto = require('crypto');

/**
 * Generate a unique system ID like IGCIM2400001
 * Format: PREFIX + YY + SEQUENCE (zero-padded 5 digits)
 */
const generateSystemId = (prefix = 'IGCIM', sequence) => {
  const year = new Date().getFullYear().toString().slice(-2);
  const seq = String(sequence).padStart(5, '0');
  return `${prefix}${year}${seq}`;
};

/**
 * Generate referral code like IGCIM1234 (8 chars, uppercase)
 */
const generateReferralCode = (prefix = 'IGCIM') => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = prefix;
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
};

/**
 * Generate a 6-digit numeric OTP
 */
const generateOTP = () => {
  return String(Math.floor(100000 + Math.random() * 900000));
};

module.exports = { generateSystemId, generateReferralCode, generateOTP };
