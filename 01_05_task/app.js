/**
 * Railway task: activate route X-01 via hub.ag3nts.org/verify.
 * Uses railway-api.js. Run: node app.js or npm run lesson5:task (from repo root).
 */

import { callRailwayApi, hasFlag, getApikeyFromEnv } from "./railway-api.js";

function log(prefix, ...args) {
  console.log(`[${new Date().toISOString()}] ${prefix}`, ...args);
}

async function main() {
  const apikey = await getApikeyFromEnv();
  if (!apikey) {
    console.error("Missing HUB_APIKEY in .env");
    process.exit(1);
  }

  const helpRes = await callRailwayApi(apikey, { action: "help" });
  if (helpRes.status !== 200) {
    console.error("Help failed:", helpRes.data);
    process.exit(1);
  }

  if (hasFlag(helpRes.data)) {
    console.log("\n--- FLAG ---\n", hasFlag(helpRes.data));
    return;
  }

  log("DOCS", JSON.stringify(helpRes.data.help ?? helpRes.data, null, 2));

  const route = "X-01";
  const sequence = [
    { action: "reconfigure", route },
    { action: "setstatus", route, value: "RTOPEN" },
    { action: "save", route },
  ];

  for (const answer of sequence) {
    const res = await callRailwayApi(apikey, answer);
    const f = hasFlag(res.data);
    if (f) {
      console.log("\n--- FLAG ---\n", f);
      return;
    }
    if (res.data.message) log("API", res.data.message);
  }

  console.error("No flag received.");
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
