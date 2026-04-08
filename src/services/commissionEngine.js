const pool = require('../config/db');
const { sendEmail } = require('./emailService');

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
            a.snapshot_fee, a.snapshot_commission_percent, a.snapshot_commission_ic,
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

  // Get global conversion rate for scaling
  const convResult = await client.query(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'ic_conversion_rate'"
  );
  const conversionRate = parseFloat(convResult.rows[0]?.setting_value || '1.0');

  // Calculate Level 1 commission amount
  // If the course had a flat IC commission set, use it. Otherwise compute scaled percentage.
  let amount = 0;
  if (adm.snapshot_commission_ic !== null && adm.snapshot_commission_ic !== undefined) {
    amount = parseFloat(adm.snapshot_commission_ic);
  } else {
    // scale IC based on conversion rate so that (IC * rate) = (Fee * Percent / 100)
    const inrValue = (parseFloat(adm.snapshot_fee) * parseFloat(adm.snapshot_commission_percent)) / 100;
    amount = parseFloat((inrValue / conversionRate).toFixed(2));
  }

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
      const l2InrValue = (parseFloat(adm.snapshot_fee) * parseFloat(settings.level_2_percent)) / 100;
      const l2Amount = parseFloat((l2InrValue / conversionRate).toFixed(2));
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

  // Send "Commission Earned" Alert Asynchronously
  (async () => {
    try {
      const userRes = await client.query('SELECT full_name, email FROM users WHERE id = $1', [adm.referred_by_user_id]);
      if (userRes.rows.length > 0) {
        const user = userRes.rows[0];
        const earnHtml = `
          <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
            <p>Congratulations <strong>${user.full_name}</strong>!</p>
            <p>Your referral's admission has just been approved by the centre administrator.</p>
            <div style="background: #e6f7ff; padding: 15px; border-left: 4px solid #1890ff; margin: 20px 0;">
              <h2 style="color: #0A2463; margin: 0;">${amount} IC Credited!</h2>
              <p style="margin: 5px 0 0 0; color: #555;">Level 1 Commission</p>
            </div>
            <p>This amount has been added to your IGCIM Commission Wallet and is now available for withdrawal.</p>
            <p>Log in to your dashboard to view your total earnings and request a payout.</p>
            <p>Keep up the great work!<br>IGCIM Computer Centre</p>
          </div>
        `;
        sendEmail(user.email, 'Earned: New Commission Credited!', earnHtml).catch(e => console.error("Commission earned email error:", e));
      }
    } catch (e) {
       console.error("Failed to send commission notification:", e);
    }
  })();

  return { generated: true, amount, message: 'Commission generated successfully' };
};

module.exports = { generateCommission };
