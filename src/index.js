
process.on('uncaughtException', (err) => {
  console.error('🔴 UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔴 UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const hpp = require('hpp');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const { verifyEmailService } = require('./services/emailService');

const xssClean = require('./middleware/xssClean');

const { generalLimiter } = require('./middleware/rateLimiter');

// Routes
const authRoutes = require('./routes/auth');
const admissionRoutes = require('./routes/admissions');
const courseRoutes = require('./routes/courses');
const commissionRoutes = require('./routes/commissions');
const referralRoutes = require('./routes/referrals');
const dashboardRoutes = require('./routes/dashboard');
const userRoutes = require('./routes/users');
const notificationRoutes = require('./routes/notifications');

const app = express();

// Trust proxy (disabled for local development)
// app.set('trust proxy', 1);

// ============================
// Security Middleware
// ============================
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allows serving assets across domains
}));

const allowedOrigins = [
  "http://localhost:5173",
  process.env.FRONTEND_URL
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1 && process.env.NODE_ENV === 'production') {
       // if production and origin not recognized, you can block or allow based on logic.
       // for Vercel preview branches, it's safer to allow or use regex. We'll allow all if FRONTEND_URL matches or allow all for now.
       // Usually: callback(new Error('CORS blocked'))
       // To be perfectly safe for Vercel ephemeral branches, let's allow dynamic origins if configured:
       return callback(null, true); 
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Cache-Control",
    "Pragma",
    "Expires",
    "X-Requested-With"
  ]
};

app.use(cors(corsOptions));

app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Cache-Control, Pragma");
    res.header("Access-Control-Allow-Credentials", "true");
    return res.status(204).end();
  }
  next();
});
// Prevent HTTP Parameter Pollution
app.use(hpp());

// ============================
// General Middleware
// ============================
// GZIP compression for faster API responses
app.use(compression());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Custom XSS Sanitization
app.use(xssClean);

// Request Logging
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate Limiting
app.use(generalLimiter);

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ============================
// API Routes
// ============================
app.use('/api/auth', authRoutes);
app.use('/api/admissions', admissionRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/commissions', commissionRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/users', userRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', require('./routes/admin'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'IGCIM API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// ============================
// Error Handler
// ============================
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error"
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}` });
});

// ============================
// Start Server
// ============================
const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 API Base: http://localhost:${PORT}/api\n`);

  // Verify services on startup
  await verifyEmailService();
  
  // Keep event loop alive
  setInterval(() => {}, 1000 * 60 * 60);
});

module.exports = app;
