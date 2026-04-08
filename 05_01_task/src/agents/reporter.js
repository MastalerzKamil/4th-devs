/**
 * Reporter Agent — pure JavaScript, zero LLM calls.
 *
 * Responsibilities:
 *  1. Read extracted facts from the blackboard
 *  2. Validate all required fields are present and correctly typed
 *  3. Send the final `transmit` report to the Hub API
 *  4. Return the Hub API response (contains the flag on success)
 *
 * Cost strategy: NO tokens spent here. Pure API call.
 */

import { transmitReport } from "../hubApi.js";

/**
 * @param {object} opts
 * @param {string} opts.apikey
 * @param {object} opts.blackboard
 * @returns {Promise<object>} Hub API response
 * @throws {Error} if required facts are missing or malformed
 */
export const runReporterAgent = async ({ apikey, blackboard }) => {
  const facts = blackboard.get("extractedFacts");

  if (!facts) {
    throw new Error("[ReporterAgent] No extractedFacts on blackboard");
  }

  const { cityName, cityArea, warehousesCount, phoneNumber } = facts;

  // Strict validation before transmitting
  const errors = [];
  if (!cityName || typeof cityName !== "string" || !cityName.trim()) {
    errors.push("cityName is missing or empty");
  }
  if (!cityArea || isNaN(parseFloat(cityArea))) {
    errors.push("cityArea is missing or not a number");
  }
  if (warehousesCount == null || isNaN(parseInt(warehousesCount, 10))) {
    errors.push("warehousesCount is missing or not a number");
  }
  if (!phoneNumber || !/^\d+$/.test(String(phoneNumber))) {
    errors.push("phoneNumber is missing or contains non-digits");
  }

  if (errors.length > 0) {
    throw new Error(`[ReporterAgent] Validation failed:\n  - ${errors.join("\n  - ")}`);
  }

  // Ensure correct types for transmission
  const report = {
    cityName: cityName.trim(),
    cityArea: parseFloat(cityArea).toFixed(2),     // "12.34" format
    warehousesCount: parseInt(warehousesCount, 10), // integer
    phoneNumber: String(phoneNumber).replace(/\D/g, ""), // digits only
  };

  console.log("\n\x1b[36m[ReporterAgent]\x1b[0m Transmitting report:", report);

  const result = await transmitReport(apikey, report);

  console.log("[ReporterAgent] Hub response:", JSON.stringify(result, null, 2));
  return result;
};
