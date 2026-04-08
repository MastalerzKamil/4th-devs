/**
 * Listener Agent — pure JavaScript, zero LLM calls.
 *
 * Responsibilities:
 *  1. Call the Hub API `listen` action in a loop
 *  2. Pass each response through the signal router (local decode/classify)
 *  3. Write extracted text/decoded content to the blackboard
 *  4. Stop when the API signals session completion or max rounds reached
 *
 * Cost strategy: NO tokens spent here. All routing is programmatic.
 */

import { listenSignal } from "../hubApi.js";
import { routeSignal } from "../signalRouter.js";
import { MAX_LISTEN_ROUNDS } from "../taskConfig.js";

/**
 * @param {object} opts
 * @param {string}        opts.apikey
 * @param {object}        opts.blackboard
 * @param {Function|null} opts.visionAnalyze   - async (buffer, mime) => string
 * @param {Function|null} opts.audioTranscribe - async (buffer, mime) => string
 */
export const runListenerAgent = async ({ apikey, blackboard, visionAnalyze = null, audioTranscribe = null }) => {
  console.log("\n\x1b[36m[ListenerAgent]\x1b[0m Starting signal collection loop…");

  for (let round = 1; round <= MAX_LISTEN_ROUNDS; round++) {
    process.stdout.write(`\r[ListenerAgent] Round ${round}/${MAX_LISTEN_ROUNDS}  `);

    let response;
    try {
      response = await listenSignal(apikey);
    } catch (err) {
      blackboard.addError(`Listen round ${round}: ${err.message}`);
      console.warn(`\n[ListenerAgent] Network error on round ${round}: ${err.message}`);
      continue;
    }

    const tag = await routeSignal(response, blackboard, visionAnalyze, audioTranscribe);

    if (blackboard.get("sessionDone")) {
      console.log(`\n[ListenerAgent] Session complete after ${round} rounds.`);
      break;
    }

    if (round === MAX_LISTEN_ROUNDS) {
      console.log(`\n[ListenerAgent] Reached max rounds (${MAX_LISTEN_ROUNDS}).`);
    }
  }

  const state = blackboard.getAll();
  console.log(
    `[ListenerAgent] Summary — total signals: ${state.signalsTotal}, ` +
    `transcriptions: ${state.transcriptions.length}, ` +
    `binary content: ${state.binaryContent.length}`
  );
};
