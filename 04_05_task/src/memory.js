/**
 * Shared in-process memory for the orchestrator.
 *
 * Passed by reference to all sub-agents so they can read from / write to
 * a single source of truth without serialisation overhead.
 */
export const createMemory = () => {
  const store = {};

  return {
    get: (key) => store[key],
    set: (key, value) => { store[key] = value; },
    getAll: () => ({ ...store }),
    setAll: (data) => Object.assign(store, data),
    has: (key) => key in store,
  };
};
