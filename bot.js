const axios = require('axios');
const cron = require('node-cron');

/**
 * IGCIM Telegram Monitoring Bot (Integrated Module)
 * Designed to run inside the main backend process.
 */

const { BOT_TOKEN, CHAT_ID, BASE_URL, MONITOR_API_KEY } = process.env;

// State management for alert cooldowns (15-minute prevention)
const lastSentAt = {
    health: 0,
    expense: 0,
    fraud: 0
};
const ALERT_COOLDOWN_MS = 15 * 60 * 1000; 

// Utility for structured premium logging
const log = (message) => {
    const timestamp = new Date().toLocaleString();
    console.log(`[BOT] ${timestamp} → ${message}`);
};

/**
 * Send message to Telegram with Spam Control
 */
const sendTelegram = async (type, text) => {
    if (!BOT_TOKEN || !CHAT_ID) {
        log("❌ ERROR: Missing Telegram credentials in .env");
        return;
    }

    const now = Date.now();
    if (type !== 'summary' && type !== 'activation') {
        if (now - lastSentAt[type] < ALERT_COOLDOWN_MS) {
            log(`Blocked spam alert for ${type} (Cooldown Active)`);
            return;
        }
    }

    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text,
            parse_mode: 'Markdown'
        });
        
        if (type !== 'summary' && type !== 'activation') {
            lastSentAt[type] = now;
        }
        
        log(`✅ Telegram ${type === 'summary' ? 'Report' : 'Alert'} Sent`);
    } catch (err) {
        log(`❌ Telegram Send Failure: ${err.message}`);
    }
};

/**
 * Monitoring Helper Functions
 */
const checkHealth = async () => {
    log("Health Check Triggered...");
    try {
        const res = await axios.get(`${BASE_URL}/api/health`, { timeout: 10000 });
        if (res.status === 200) {
            log("Health Check: SUCCESS (Stay Silent)");
        } else {
            throw new Error(`Status ${res.status}`);
        }
    } catch (err) {
        log(`🔴 ALERT: API is DOWN! Error: ${err.message}`);
        await sendTelegram('health', `🚨 *CRITICAL ALERT*: IGCIM API is UNREACHABLE!\nError: ${err.message}\nURL: ${BASE_URL}`);
    }
};

const checkExpense = async () => {
    log("Expense Check Triggered...");
    try {
        const res = await axios.get(`${BASE_URL}/api/admin/metrics/expense`, {
            headers: { 'x-api-key': MONITOR_API_KEY },
            timeout: 10000
        });
        const { expense_ratio, status_color } = res.data.data;
        log(`Expense Ratio: ${expense_ratio.toFixed(2)}% [${status_color}]`);

        if (status_color === 'RED') {
            await sendTelegram('expense', `⚠️ *DANGER*: Expense Ratio is CRITICAL: ${expense_ratio.toFixed(2)}%!\nSustainability thresholds exceeded.`);
        } else if (status_color === 'YELLOW') {
            log("Sustainability Warning (Yellow) - Logged but staying silent.");
        } else {
            log("Sustainability OK (Green)");
        }
    } catch (err) {
        log(`❌ Expense Check Failed: ${err.message}`);
    }
};

const checkFraud = async () => {
    log("Fraud Sentinel Triggered...");
    try {
        const res = await axios.get(`${BASE_URL}/api/admin/fraud/alerts`, {
            headers: { 'x-api-key': MONITOR_API_KEY },
            timeout: 10000
        });
        if (res.data.count > 0) {
            log(`Found ${res.data.count} suspicious admissions. Sending Alert.`);
            let msg = `🛡️ *FRAUD ALERT*: ${res.data.count} High-Risk Admissions Detected!\n\n`;
            res.data.data.forEach(adm => {
                msg += `• ${adm.student_name} (${adm.fraud_flags.join(', ')})\n`;
            });
            await sendTelegram('fraud', msg);
        } else {
            log("Fraud Scan: Clean (Stay Silent)");
        }
    } catch (err) {
        log(`❌ Fraud Scan Failed: ${err.message}`);
    }
};

const sendDailyReport = async () => {
    log("Generating Daily Performance Snapshot...");
    try {
        const res = await axios.get(`${BASE_URL}/api/admin/summary`, {
            headers: { 'x-api-key': MONITOR_API_KEY },
            timeout: 15000
        });
        const { total_admissions, approved_count, total_revenue, total_payout, approval_rate } = res.data.data;
        const report = `📊 *DAILY PERFORMANCE REPORT*\n(Last 24 Hours)\n\n` +
            `✅ *Admissions*: ${total_admissions}\n` +
            `✔️ *Approved*: ${approved_count} (${approval_rate.toFixed(1)}%)\n` +
            `💰 *Revenue*: ₹${total_revenue.toLocaleString()}\n` +
            `💸 *Payout*: ₹${total_payout.toLocaleString()}\n\n` +
            `🚀 Keep Growing!`;
        await sendTelegram('summary', report);
        log("Performance Snapshot successfully delivered.");
    } catch (err) {
        log(`❌ Daily Report Failed: ${err.message}`);
    }
};

/**
 * Main Exported Integration Function
 */
function startMonitoringBot() {
    log("🚀 Initializing Integrated Monitoring Bot...");
    log(`Targeting BASE_URL: ${BASE_URL}`);

    // Schedule 5-minute critical checks
    cron.schedule('*/5 * * * *', () => {
        checkHealth();
        checkExpense();
        checkFraud();
    });

    // Schedule daily summary (9 AM IST)
    cron.schedule('0 9 * * *', () => {
        sendDailyReport();
    });

    // Run initial health check & activation message
    checkHealth().then(() => {
        sendTelegram('activation', "🤖 *IGCIM Monitoring Bot Integrated*\nService is now running inside the main backend process.");
    }).catch(err => log(`Manual Activation Check Failed: ${err.message}`));

    log("✅ Monitoring Scheduler Active");
}

module.exports = { startMonitoringBot };
