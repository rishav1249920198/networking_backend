const axios = require('axios');
require('dotenv').config();

/**
 * Referral System Audit Simulation
 * Rules:
 * - 1 IC = ₹50
 * - Multipliers: 1-2(1.0x), 3-4(1.5x), 5-6(2.5x), 7-10(0.5x), 11-20(0.25x), 21+(0.1x)
 * - Overrides: L1 (1%), L2 (0.5%)
 * - Bonuses: ALL REMOVED
 */

const CONVERSION_RATE = 50.0;
const OVERRIDE_L1 = 0.01;
const OVERRIDE_L2 = 0.005;

// Course Data (Actual from DB)
const COURSES = {
  ADCA: { name: 'ADCA', fee: 8550.00, base_amount: 100 },
  DCA: { name: 'DCA', fee: 5500.00, base_amount: 50 },
  MIN: { name: 'MIN_TEST', fee: 1000.00, base_amount: 50 } // Worst case test
};

function calculateMultiplier(index) {
  if (index <= 2) return 1.0;
  if (index <= 4) return 1.5;
  if (index <= 6) return 2.5;
  if (index <= 10) return 0.5;
  if (index <= 20) return 0.25;
  return 0.1;
}

function simulateNetwork(totalUsers, courseKey) {
  const course = COURSES[courseKey];
  let totalRevenue = totalUsers * course.fee;
  let totalPayout = 0;

  // We assume a tree where every user can refer up to 6 others (balanced)
  // Level 0: Root (1)
  // Level 1: 6 users (Direct to Root)
  // Level 2: 36 users (Direct to Level 1)
  // Level 3: 216 users (Direct to Level 2)
  
  // Total Payout calculation for N users joining the network
  // For each user joining:
  // 1. Their sponsor gets Direct Commission (Multiplier * base_amount)
  // 2. Sponsor's sponsor (L1 Ancestor) gets 1% * base_amount
  // 3. L1 Ancestor's sponsor (L2 Ancestor) gets 0.5% * base_amount

  // However, since we are doing aggregate:
  // We can track the 'direct_count' of each sponsor.
  let sponsorCounts = {}; // sponsorId -> count

  for (let i = 1; i <= totalUsers; i++) {
    // 1. Assign a sponsor (balanced tree logic)
    // S0 refers 1-6
    // S1 refers 7-12
    // S2 refers 13-18...
    let sponsorId = Math.floor((i - 1) / 6);
    sponsorCounts[sponsorId] = (sponsorCounts[sponsorId] || 0) + 1;
    let refIndex = sponsorCounts[sponsorId];

    // Direct Commission
    let multiplier = calculateMultiplier(refIndex);
    totalPayout += course.base_amount * multiplier;

    // Override L1 (if sponsor has a sponsor)
    if (sponsorId > 0) {
      totalPayout += course.base_amount * OVERRIDE_L1;
    }

    // Override L2 (if sponsor's sponsor has a sponsor)
    let parentSponsorId = Math.floor((sponsorId - 1) / 6);
    if (sponsorId > 0 && parentSponsorId >= 0 && sponsorId > parentSponsorId) {
       // Only if parentSponsorId exists and is higher up
       // In our simplified model: S(n) -> S(Math.floor((n-1)/6))
       totalPayout += course.base_amount * OVERRIDE_L2;
    }
  }

  const expenseRatio = (totalPayout / totalRevenue) * 100;
  return {
    totalUsers,
    revenue: totalRevenue,
    payout: totalPayout,
    ratio: expenseRatio.toFixed(2) + '%'
  };
}

console.log('--- IGCIM REFERRAL SYSTEM FINAL AUDIT ---');
console.log('Scenario A (Small - ~15 users):', simulateNetwork(15, 'ADCA'));
console.log('Scenario B (Medium - ~100 users):', simulateNetwork(100, 'ADCA'));
console.log('Scenario C (Large - 250 users):', simulateNetwork(250, 'ADCA'));
console.log('Worst-Case (Low Fee, Max Multiplier):', simulateNetwork(250, 'MIN'));

console.log('\n--- VERDICT ---');
const auditLarge = simulateNetwork(250, 'ADCA');
const auditWorst = simulateNetwork(250, 'MIN');

console.log(`Current Risk (ADCA): ${parseFloat(auditLarge.ratio) < 5 ? 'SAFE' : 'RISKY'}`);
console.log(`Worst Risk (MIN): ${parseFloat(auditWorst.ratio) < 5 ? 'SAFE' : 'RISKY'}`);
console.log('All Bonuses: DISABLED');
