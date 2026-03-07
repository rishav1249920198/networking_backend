const pool = require('../config/db');

/**
 * Generate commission for an approved admission.
 * Called ONLY from the admission approval flow.
 * @param {string} admissionId - UUID of the admission being approved
 * @param {object} client - optional pg transaction client
 */
const generateCommission = async (admissionId, client = pool) => {
  // Fetch admission with referral info
  const admResult = await client.query(
    `SELECT a.id, a.referred_by_user_id, a.centre_id,
            a.snapshot_fee, a.snapshot_commission_percent,
            a.status
     FROM admissions a
     WHERE a.id = $1`,
    [admissionId]
  );

  if (admResult.rows.length === 0) {
    throw new Error('Admission not found');
  }

  const adm = admResult.rows[0];

  if (adm.status !== 'approved') {
    throw new Error('Commission can only be generated for approved admissions');
  }

  if (!adm.referred_by_user_id) {
    // No referrer — no commission
    return { generated: false, message: 'No referrer — commission skipped' };
  }

  // Check if commission already generated
  const existing = await client.query(
    `SELECT id FROM commissions WHERE admission_id = $1`,
    [admissionId]
  );
  if (existing.rows.length > 0) {
    return { generated: false, message: 'Commission already generated' };
  }

  // Get commission settings for the centre
  const settingsResult = await client.query(
    `SELECT default_percent, multi_level, level_2_percent, level_3_percent
     FROM commission_settings WHERE centre_id = $1`,
    [adm.centre_id]
  );

  const settings = settingsResult.rows[0] || { multi_level: false };

  // Calculate Level 1 commission amount
  const amount = parseFloat(
    ((adm.snapshot_fee * adm.snapshot_commission_percent) / 100).toFixed(2)
  );

  // Insert Level 1 commission
  await client.query(
    `INSERT INTO commissions
      (admission_id, referrer_id, centre_id, snapshot_fee, snapshot_percent, amount, level, status)
     VALUES ($1, $2, $3, $4, $5, $6, 1, 'pending')`,
    [
      admissionId,
      adm.referred_by_user_id,
      adm.centre_id,
      adm.snapshot_fee,
      adm.snapshot_commission_percent,
      amount,
    ]
  );

  // Multi-level commissions (disabled by default)
  if (settings.multi_level) {
    const referrerResult = await client.query(
      `SELECT referred_by FROM users WHERE id = $1`,
      [adm.referred_by_user_id]
    );

    if (referrerResult.rows[0]?.referred_by && settings.level_2_percent > 0) {
      const l2Amount = parseFloat(
        ((adm.snapshot_fee * settings.level_2_percent) / 100).toFixed(2)
      );
      await client.query(
        `INSERT INTO commissions
          (admission_id, referrer_id, centre_id, snapshot_fee, snapshot_percent, amount, level, status)
         VALUES ($1, $2, $3, $4, $5, $6, 2, 'pending')`,
        [
          admissionId,
          referrerResult.rows[0].referred_by,
          adm.centre_id,
          adm.snapshot_fee,
          settings.level_2_percent,
          l2Amount,
        ]
      );
    }
  }

  return { generated: true, amount, message: 'Commission generated successfully' };
};

module.exports = { generateCommission };
