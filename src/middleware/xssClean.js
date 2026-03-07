const DOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const window = new JSDOM('').window;
const purify = DOMPurify(window);

const sanitize = (obj) => {
  if (typeof obj === 'string') {
    return purify.sanitize(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map((v) => sanitize(v));
  }
  if (typeof obj === 'object' && obj !== null) {
    const sanitizedObj = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        sanitizedObj[key] = sanitize(obj[key]);
      }
    }
    return sanitizedObj;
  }
  return obj;
};

const xssClean = (req, res, next) => {
  if (req.body) req.body = sanitize(req.body);
  if (req.query) req.query = sanitize(req.query);
  if (req.params) req.params = sanitize(req.params);
  next();
};

module.exports = xssClean;
