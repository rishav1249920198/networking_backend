const pool = require('../config/db');
const { toIC } = require('../utils/conversionUtils');

class EngagementService {
    /**
     * Handles Daily Login Bonus logic.
     * Cycle: 0.002, 0.002, 0.003, 0.003, 0.004, 0.004, 0.01 IC (7-day reset)
     * Hardened: 30-hour streak window.
     */
    static async processDailyCheckIn(userId, lastCheckinDate, client = pool) {
        // 1. Check for streak reset (30 hours)
        let resetStreak = false;
        if (lastCheckinDate) {
            const lastDate = new Date(lastCheckinDate);
            const now = new Date();
            const hoursSinceLast = (now - lastDate) / (1000 * 60 * 60);
            if (hoursSinceLast > 30) resetStreak = true;
        }

        // 2. Determine cycle day
        let cycleDay = 1;
        if (!resetStreak) {
            const historyRes = await client.query(
                `SELECT COUNT(*) FROM points_transactions WHERE user_id = $1 AND type = 'daily_checkin'`,
                [userId]
            );
            const totalClaims = parseInt(historyRes.rows[0].count);
            cycleDay = (totalClaims % 7) + 1;
        }

        const cycleRewards = [0.002, 0.002, 0.003, 0.003, 0.004, 0.004, 0.01];
        const icAmount = cycleRewards[cycleDay - 1];

        await this.recordBonus(userId, icAmount, 'daily_checkin', `Daily Login Reward - Day ${cycleDay}`, client);
        return { icAmount, cycleDay, reset: resetStreak };
    }

    /**
     * Registration Bonus - given after verification
     */
    static async grantRegistrationBonus(userId, client = pool) {
        const type = 'registration_bonus';
        // Idempotency check
        const exists = await client.query('SELECT 1 FROM points_transactions WHERE user_id = $1 AND type = $2', [userId, type]);
        if (exists.rowCount > 0) return;
        
        const icAmount = 0.03;
        await this.recordBonus(userId, icAmount, type, 'Welcome Registration Bonus', client);
    }

    /**
     * Referral Activation Bonus - given when referral is approved
     */
    static async grantReferralActivationBonus(sponsorId, referralName, client = pool) {
        const icAmount = 0.05;
        // Admission ID based idempotency is handled in EarningEngine, 
        // but we add a safety check here too.
        await this.recordBonus(sponsorId, icAmount, 'referral_activation_bonus', `Engagement Bonus: Referral Active (${referralName})`, client);
    }

    /**
     * Profile Completion Bonus - given once
     */
    static async grantProfileCompletionBonus(userId, client = pool) {
        const type = 'profile_completion_bonus';
        const exists = await client.query('SELECT 1 FROM points_transactions WHERE user_id = $1 AND type = $2', [userId, type]);
        if (exists.rowCount > 0) return;

        const icAmount = 0.02;
        await this.recordBonus(userId, icAmount, type, 'Profile Completion Reward', client);
    }

    /**
     * Low-level helper to record bonus and update wallet
     */
    static async recordBonus(userId, icAmount, type, note, client = pool) {
        const rupees = icAmount * 50; 
        
        // 1. Add Transaction with simple deduplication for daily_checkin per physical day safely
        const today = new Date().toISOString().split('T')[0];
        if (type === 'daily_checkin') {
            const dup = await client.query(
                "SELECT 1 FROM points_transactions WHERE user_id = $1 AND type = 'daily_checkin' AND DATE(created_at) = $2",
                [userId, today]
            );
            if (dup.rowCount > 0) return;
        }

        await client.query(`
            INSERT INTO points_transactions 
                (user_id, points, rupees, type, note, level, amount)
            VALUES ($1, $2, $3, $4, $5, 0, $6)
        `, [userId, icAmount, rupees, type, note, rupees]);

        // 2. Atomic Wallet Update
        await client.query(`
            INSERT INTO points_wallet (user_id, total_points, total_rupees, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (user_id) DO UPDATE SET
                total_points = points_wallet.total_points + EXCLUDED.total_points,
                total_rupees = points_wallet.total_rupees + EXCLUDED.total_rupees,
                updated_at = NOW()
        `, [userId, icAmount, rupees]);
    }
}

module.exports = EngagementService;
