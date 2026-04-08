/**
 * Blackboard — shared state store used by all agents.
 *
 * All agents read from and write to this single source of truth.
 * Passed by reference so every mutation is immediately visible everywhere.
 *
 * Schema:
 *  transcriptions  — text fragments from radio signals (text-only, no binaries)
 *  binaryContent   — text extracted locally from decoded binary payloads
 *  extractedFacts  — { cityName, cityArea, warehousesCount, phoneNumber } (or nulls)
 *  sessionDone     — true once API signals no more data is available
 *  signalsTotal    — count of all received signals (including noise)
 *  signalsUseful   — count of signals that yielded usable content
 *  errors          — non-fatal error messages for debugging
 */
export const createBlackboard = () => {
  const state = {
    transcriptions: [],
    binaryContent: [],
    extractedFacts: {
      cityName: null,
      cityArea: null,
      warehousesCount: null,
      phoneNumber: null,
    },
    sessionDone: false,
    signalsTotal: 0,
    signalsUseful: 0,
    errors: [],
  };

  return {
    /** Read a top-level field. */
    get: (key) => state[key],

    /** Write a top-level field. */
    set: (key, value) => { state[key] = value; },

    /** Append a text transcription. */
    addTranscription: (text) => {
      state.transcriptions.push(text);
      state.signalsUseful++;
    },

    /** Append locally-decoded binary content (already converted to readable text). */
    addBinaryContent: (text) => {
      state.binaryContent.push(text);
      state.signalsUseful++;
    },

    /** Record a non-fatal error. */
    addError: (msg) => state.errors.push(msg),

    /** Increment total signal counter. */
    incrementSignals: () => { state.signalsTotal++; },

    /** Merge extracted facts (partial update). */
    mergeFacts: (facts) => {
      Object.assign(state.extractedFacts, facts);
    },

    /** Returns true when all four required facts are present and non-empty. */
    factsComplete: () => {
      const f = state.extractedFacts;
      const hasValue = (v) => v != null && v !== "" && v !== "null";
      return (
        hasValue(f.cityName) &&
        hasValue(f.cityArea) &&
        f.warehousesCount != null && // 0 is a valid warehouse count
        hasValue(f.phoneNumber)
      );
    },

    /** Return a shallow copy of the entire state for logging/debugging. */
    getAll: () => ({ ...state }),

    /** Produce a concise human-readable summary for the orchestrator. */
    summary: () => {
      const f = state.extractedFacts;
      return [
        `Signals: ${state.signalsTotal} total, ${state.signalsUseful} useful`,
        `Transcriptions: ${state.transcriptions.length}`,
        `Binary content: ${state.binaryContent.length}`,
        `Session done: ${state.sessionDone}`,
        `Facts: cityName=${f.cityName}, cityArea=${f.cityArea}, warehouses=${f.warehousesCount}, phone=${f.phoneNumber}`,
        state.errors.length ? `Errors (${state.errors.length}): ${state.errors.slice(-3).join(" | ")}` : "",
      ].filter(Boolean).join("\n");
    },
  };
};
