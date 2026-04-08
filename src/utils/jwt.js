const jwt = require('jsonwebtoken');
require('dotenv').config();

const SECRET = process.env.JWT_SECRET || 'igcim_secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || SECRET + '_refresh_token';

const signToken = (payload) => {
  return jwt.sign(payload, SECRET, { expiresIn: '15m' }); // Short-lived Access Token
};

const signRefreshToken = (payload) => {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: '7d' }); // Long-lived Refresh Token
};

const verifyToken = (token) => {
  return jwt.verify(token, SECRET);
};

const verifyRefreshToken = (token) => {
  return jwt.verify(token, REFRESH_SECRET);
};

module.exports = { signToken, signRefreshToken, verifyToken, verifyRefreshToken };
