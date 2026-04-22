/**
 * Centralized Financial Conversion Utilities for IC Points System
 * Rule: 1 IC Point = 50 Rupees
 */

const CONVERSION_RATE = 50.0;

/**
 * Converts Rupee amount to IC Points
 * @param {number} rupees 
 * @returns {number} points
 */
const toIC = (rupees) => {
  if (!rupees) return 0;
  return parseFloat((parseFloat(rupees) / CONVERSION_RATE).toFixed(4));
};

/**
 * Converts IC Points to Rupee amount
 * @param {number} points 
 * @returns {number} rupees
 */
const toRupees = (points) => {
  if (!points) return 0;
  return parseFloat((parseFloat(points) * CONVERSION_RATE).toFixed(2));
};

/**
 * Formats points for display (max 2 decimal places)
 * @param {number} points 
 * @returns {string}
 */
const formatIC = (points) => {
  return parseFloat(points || 0).toFixed(2);
};

module.exports = {
  CONVERSION_RATE,
  toIC,
  toRupees,
  formatIC
};
