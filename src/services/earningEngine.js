const pool = require('../config/db');
const NotificationService = require('./notificationService');
const { toIC } = require('../utils/conversionUtils');
const EngagementService = require('./engagementService');

/**
 * Earning Engine - Production Lock Version
 * Implements variable cap, progressive boost, and rolling override logic.
 */
class EarningEngine {
    /**
     * Calculates the direct earning with progressive boost.
     * Rule: 
     * Ref 1-2: Base (Points * 50)
     * Ref 3-4: Base + 10
     * Ref 5-6: Base + 25
     * Ref >6: Base
     */
    static calculateDirectWithBoost(points, referralCount) {
        const base = Math.floor(parseFloat(points || 0) * 50);
        let boost = 0;
        
        const nextRefIndex = referralCount + 1;
        
        if (nextRefIndex >= 3 && nextRefIndex <= 4) boost = 10;
        else if (nextRefIndex >= 5 && nextRefIndex <= 6) boost = 25;
        
        return { base, boost, total: base + boost };
    }

    /**
     * Processes earnings for an approved admission.
     * Hardened: Atomic transaction with rolling cap enforcement.
     */
    static async processAdmissionEarning(admissionId, client = pool) {
        const ownsTransaction = !(client !== pool);
        const dbClient = client === pool ? await pool.connect() : client;

        try {
            if (ownsTransaction) await dbClient.query('BEGIN');

            // 1. Lock Admission & Check Idempotency
            const admRes = await dbClient.query(`
                SELECT id, earning_processed, status, referred_by_user_id, student_id, course_id, snapshot_fee
                FROM admissions WHERE id = $1 FOR UPDATE
            `, [admissionId]);

            if (admRes.rows.length === 0) throw new Error('Admission not found');
            const adm = admRes.rows[0];

            if (adm.status !== 'approved') throw new Error(`Admission ${admissionId} is ${adm.status}`);
            if (adm.earning_processed) {
                if (ownsTransaction) await dbClient.query('ROLLBACK');
                return { success: true, message: 'Already processed' };
            }

            // 2. Load Course Config (Production Lock Fields)
            const courseRes = await dbClient.query(`
                SELECT fee, points, cap_percent, level_distribution, boost_enabled 
                FROM courses WHERE id = $1
            `, [adm.course_id]);
            const course = courseRes.rows[0];
            if (!course) throw new Error('Course not found');

            const sponsorId = adm.referred_by_user_id;

            // No sponsor -> Mark processed and return
            if (!sponsorId) {
                await dbClient.query('UPDATE admissions SET earning_processed = TRUE WHERE id = $1', [admissionId]);
                if (ownsTransaction) await dbClient.query('COMMIT');
                return { success: true, message: 'Direct admission (No sponsor)' };
            }

            // 3. Cap Calculation
            const capPercent = parseFloat(course.cap_percent || 5);
            const totalCapRupees = Math.floor((parseFloat(adm.snapshot_fee) * capPercent) / 100);

            // 4. Sponsor Progress & Direct Earning
            const sponsorRes = await dbClient.query(`
                SELECT direct_referral_count, boost_level FROM users WHERE id = $1 FOR UPDATE
            `, [sponsorId]);
            const sponsor = sponsorRes.rows[0];
            
            const { base, boost, total } = this.calculateDirectWithBoost(course.points, sponsor.direct_referral_count);
            
            // Safety: Direct payout cannot exceed cap
            const finalDirect = Math.min(total, totalCapRupees);
            
            // 5. record Direct Transaction
            await this.addTransaction({
                userId: sponsorId,
                rupees: finalDirect,
                type: 'direct',
                admissionId,
                note: `Direct Referral Earning (Base: ₹${base}${boost > 0 ? `, Boost: ₹${boost}` : ''})`,
                level: 0,
                remainingPool: totalCapRupees,
                client: dbClient
            });

            // Update Sponsor Stats
            await dbClient.query(`
                UPDATE users SET 
                    direct_referral_count = direct_referral_count + 1,
                    boost_level = CASE 
                        WHEN direct_referral_count + 1 >= 5 THEN 2 
                        WHEN direct_referral_count + 1 >= 3 THEN 1 
                        ELSE 0 
                    END
                WHERE id = $1
            `, [sponsorId]);
            
            // NEW: Grant Referral Activation Bonus (for engagement)
            const studentRes = await dbClient.query('SELECT full_name FROM users WHERE id = $1', [adm.student_id]);
            await EngagementService.grantReferralActivationBonus(sponsorId, studentRes.rows[0]?.full_name, dbClient);

            // 6. Override Distribution
            let currentPool = totalCapRupees - finalDirect;
            
            if (currentPool > 0) {
                const distribution = course.level_distribution || {};
                let currentUplineId = sponsorId;
                let carryForward = 0;

                for (let i = 1; i <= 6; i++) {
                    if (currentPool <= 0) break;

                    const uplineRes = await dbClient.query('SELECT referred_by FROM users WHERE id = $1', [currentUplineId]);
                    const uplineId = uplineRes.rows[0]?.referred_by;

                    const sharePercent = parseFloat(distribution[`L${i}`] || 0);
                    // share = (currentPool * %) + carryForward
                    const rawShare = (currentPool * sharePercent) / 100 + carryForward;
                    let shareRupees = Math.floor(rawShare);
                    carryForward = rawShare - shareRupees; // Precision preservation

                    // Safety: shareRupees cannot exceed currentPool
                    if (shareRupees > currentPool) shareRupees = currentPool;

                    if (uplineId) {
                        if (shareRupees >= 1) {
                            await this.addTransaction({
                                userId: uplineId,
                                rupees: shareRupees,
                                type: `override_l${i}`,
                                admissionId,
                                note: `Level ${i} Override Commission`,
                                level: i,
                                remainingPool: currentPool,
                                client: dbClient
                            });
                        }
                        currentUplineId = uplineId;
                    } else {
                        // Missing upline -> Amount retained by system
                    }

                    currentPool -= shareRupees;
                }
            }

            // 7. Binary Rules & Unlock
            const side = (sponsor.direct_referral_count % 2 === 0) ? 'left_count' : 'right_count';
            await dbClient.query(`UPDATE users SET ${side} = ${side} + 1 WHERE id = $1`, [sponsorId]);
            await this.checkAndUnlockWithdrawal(sponsorId, dbClient);

            // 8. Finalize
            await dbClient.query('UPDATE admissions SET earning_processed = TRUE WHERE id = $1', [admissionId]);
            
            await NotificationService.createNotification(
                sponsorId,
                'Earning Credited!',
                `You earned ₹${finalDirect} from a new referral.`,
                'commission',
                '/dashboard/earnings',
                dbClient
            );

            if (ownsTransaction) await dbClient.query('COMMIT');
            return { success: true };

        } catch (err) {
            if (ownsTransaction) await dbClient.query('ROLLBACK');
            console.error('[EarningEngine] Critical Error:', err);
            throw err;
        } finally {
            if (ownsTransaction) dbClient.release();
        }
    }

    /**
     * Records a hardened transaction and updates wallet.
     */
    static async addTransaction({ userId, rupees, type, admissionId, note, level, remainingPool, client }) {
        const points = toIC(rupees);
        
        // Idempotency: Unique (user_id, admission_id, type)
        await client.query(`
            INSERT INTO points_transactions 
                (user_id, admission_id, points, rupees, type, note, level, amount, remaining_pool, source_admission_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (admission_id, type) DO NOTHING
        `, [userId, admissionId, points, rupees, type, note, level, rupees, remainingPool, admissionId]);

        // Atomic Wallet Update
        await client.query(`
            INSERT INTO points_wallet (user_id, total_points, total_rupees, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (user_id) DO UPDATE SET
                total_points = points_wallet.total_points + EXCLUDED.total_points,
                total_rupees = points_wallet.total_rupees + EXCLUDED.total_rupees,
                updated_at = NOW()
        `, [userId, points, rupees]);
    }

    /**
     * Binary Withdrawal Unlock Logic
     */
    static async checkAndUnlockWithdrawal(userId, client) {
        const res = await client.query(
            'SELECT left_count, right_count, withdrawal_unlocked FROM users WHERE id = $1 FOR UPDATE',
            [userId]
        );
        if (res.rows.length === 0) return;
        
        const { left_count, right_count, withdrawal_unlocked } = res.rows[0];
        
        if (!withdrawal_unlocked && left_count >= 1 && right_count >= 1) {
            await client.query('UPDATE users SET withdrawal_unlocked = TRUE WHERE id = $1', [userId]);
            await NotificationService.createNotification(
                userId,
                'Withdrawal Unlocked! 🔓',
                'You can now request payouts of your earnings.',
                'withdrawal',
                '/dashboard/wallet',
                client
            );
        }
    }
}

module.exports = EarningEngine;
