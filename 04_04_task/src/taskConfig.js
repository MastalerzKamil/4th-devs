export const VERIFY_URL = "https://hub.ag3nts.org/verify";
export const TASK = "filesystem";
export const NOTES_ZIP_URL = "https://hub.ag3nts.org/dane/natan_notes.zip";

/** Default for reader / analyst (override FILESYSTEM_AGENT_MODEL) */
export const DEFAULT_AGENT_MODEL = process.env.FILESYSTEM_AGENT_MODEL?.trim() || "gpt-4o-mini";
