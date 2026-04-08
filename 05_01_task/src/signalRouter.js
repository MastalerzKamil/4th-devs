/**
 * Signal Router — programmatic classifier and decoder for incoming signals.
 *
 * NEVER passes raw Base64 data to an LLM.
 * Instead it decodes payloads locally and only forwards extracted text/summaries.
 *
 * Decision tree:
 *   response.code !== 100  → session is done
 *   response.transcription → store text (Morse decoded locally if (stop) markers found)
 *   response.attachment    → decode Base64, classify by MAGIC BYTES (not mime label)
 *       JSON               → parse JSON, stringify to readable text  (≤300KB)
 *       text               → decode buffer to UTF-8 string           (≤300KB)
 *       image (confirmed)  → call visionAnalyze                      (≤1MB)
 *       audio or unknown   → skip
 *   neither                → noise, discard
 *
 * NOTE: mime labels from the API are NOT trusted for size limits — magic bytes
 * are checked first. A 560KB file labeled "image/png" that passes sniffText()
 * is treated as text and is skipped if >300KB (likely noise/decoy data).
 */

import { writeFileSync } from "node:fs";
import { MAX_AUDIO_BYTES, MAX_BINARY_BYTES, MAX_IMAGE_BYTES } from "./taskConfig.js";

const SAVE_DIR = process.env.SAVE_BINARIES_DIR || null;

// Maximum chars of text stored per binary content block (prevents context overflow)
const MAX_TEXT_CHARS = 8_000;

// ─── Morse code decoder (Ti/Ta notation) ────────────────────────────────────

const MORSE = {
  ".-": "A", "-...": "B", "-.-.": "C", "-..": "D", ".": "E",
  "..-.": "F", "--.": "G", "....": "H", "..": "I", ".---": "J",
  "-.-": "K", ".-..": "L", "--": "M", "-.": "N", "---": "O",
  ".--.": "P", "--.-": "Q", ".-.": "R", "...": "S", "-": "T",
  "..-": "U", "...-": "V", ".--": "W", "-..-": "X", "-.--": "Y",
  "--..": "Z",
  ".----": "1", "..---": "2", "...--": "3", "....-": "4", ".....": "5",
  "-....": "6", "--...": "7", "---..": "8", "----.": "9", "-----": "0",
  "-..-.": "/",  // fraction bar used as word separator in Morse
};

/**
 * Detect and decode Morse code in Ti/Ta notation.
 * Requires the "(stop)" word-separator marker as a fingerprint.
 * Returns decoded text or null if this is not a Morse transmission.
 */
const decodeTiTaMorse = (text) => {
  // The "(stop)" marker is unique to these Morse transmissions
  if (!text.includes("(stop)")) return null;

  // Confirm that most tokens are Ti/Ta sequences (not ordinary Polish text that
  // happens to contain the letters "ti" or "ta")
  const cleaned = text.replace(/\*[^*]+\*/g, "").trim();
  const tokens = cleaned.replace(/\(stop\)/gi, " ").trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return null;

  const morseTokens = tokens.filter((t) => /^(Ti|Ta)+$/.test(t));
  if (morseTokens.length / tokens.length < 0.6) return null; // < 60% Morse tokens = not Morse

  // Decode: words split by (stop), letters split by space
  const wordParts = cleaned.split(/\(stop\)/i);
  const decoded = wordParts.map((part) => {
    const letters = part.trim().split(/\s+/).filter((t) => /^(Ti|Ta)+$/.test(t));
    return letters.map((t) => {
      const morse = t.replace(/Ti/g, ".").replace(/Ta/g, "-");
      return MORSE[morse] ?? "?";
    }).join("");
  }).filter(Boolean).join(" ").trim();

  return decoded || null;
};

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Route a raw Hub API response to the appropriate handler.
 *
 * @param {object} response              - Raw Hub API JSON response
 * @param {object} blackboard            - Shared blackboard
 * @param {Function|null} visionAnalyze  - async (buffer, mime) => string | null
 * @param {Function|null} audioTranscribe - async (buffer, mime) => string | null
 * @returns {Promise<string>} signal type tag for logging
 */
export const routeSignal = async (response, blackboard, visionAnalyze = null, audioTranscribe = null) => {
  blackboard.incrementSignals();

  if (!response || typeof response !== "object") {
    blackboard.addError("Invalid response shape");
    return "invalid";
  }

  // Session finished
  if (response.code !== 100) {
    console.log(`[Router] End-of-session signal (code=${response.code}): ${response.message}`);
    blackboard.set("sessionDone", true);
    return "done";
  }

  // ── Text transcription ────────────────────────────────────────────────────
  if (typeof response.transcription === "string") {
    const raw = response.transcription.trim();
    if (!raw || isNoise(raw)) return "noise";

    // Try local Morse decode first (requires (stop) marker fingerprint)
    const morse = decodeTiTaMorse(raw);
    if (morse) {
      blackboard.addBinaryContent(`[Morse decoded]: ${morse}\n[Original Ti/Ta]: ${raw.slice(0, 200)}`);
      console.log(`[Router] Morse decoded: "${morse.slice(0, 80)}"`);
      return "morse";
    }

    blackboard.addTranscription(raw);
    console.log(`[Router] Transcription stored (${raw.length} chars)`);
    return "transcription";
  }

  // ── Binary attachment ─────────────────────────────────────────────────────
  if (typeof response.attachment === "string") {
    return handleBinary(response, blackboard, visionAnalyze, audioTranscribe);
  }

  return "noise";
};

// ─── Binary handler ──────────────────────────────────────────────────────────

const handleBinary = async (response, blackboard, visionAnalyze, audioTranscribe) => {
  const { attachment, meta, filesize } = response;
  const mime = String(meta || "").toLowerCase().trim();

  // Log meta for all binaries (even before size check) so we know what we're dealing with
  console.log(`[Router] Binary: mime="${mime}", filesize=${filesize ?? "unknown"} bytes`);

  const isAudioMime = mime.includes("audio/");
  const isImageMime = mime.includes("image/");

  // ── Pre-decode size guard ─────────────────────────────────────────────────
  // Audio gets its own (generous) limit since Whisper handles large files well
  const preLimit = isAudioMime ? MAX_AUDIO_BYTES : isImageMime ? MAX_IMAGE_BYTES : MAX_BINARY_BYTES;
  if (filesize && filesize > preLimit) {
    console.log(`[Router] Skipping pre-decode oversized binary (${filesize} bytes, limit ${preLimit})`);
    return "skipped_large";
  }

  // ── Audio transcription ───────────────────────────────────────────────────
  if (isAudioMime) {
    if (!audioTranscribe) {
      console.log("[Router] Audio binary — skipping (no transcription service)");
      return "skipped_audio";
    }
    let audioBuffer;
    try {
      audioBuffer = Buffer.from(attachment, "base64");
    } catch {
      blackboard.addError("Failed to decode Base64 audio attachment");
      return "decode_error";
    }
    if (audioBuffer.length === 0) return "noise";
    if (SAVE_DIR) {
      const ts = Date.now();
      try { writeFileSync(`${SAVE_DIR}/audio_${ts}.mp3`, audioBuffer); } catch {}
    }
    console.log(`[Router] Audio: transcribing ${audioBuffer.length} bytes…`);
    try {
      const transcript = await audioTranscribe(audioBuffer, mime);
      if (transcript && !isNoise(transcript)) {
        blackboard.addBinaryContent(`[Audio transcription]:\n${truncate(transcript, MAX_TEXT_CHARS)}`);
        console.log(`[Router] Audio transcribed (${audioBuffer.length} bytes, ${transcript.length} chars)`);
        return "audio";
      }
    } catch (err) {
      console.warn(`[Router] Audio transcription failed: ${err.message}`);
    }
    return "skipped_audio";
  }

  // Decode
  let buffer;
  try {
    buffer = Buffer.from(attachment, "base64");
  } catch {
    blackboard.addError("Failed to decode Base64 attachment");
    return "decode_error";
  }

  if (buffer.length === 0) return "noise";

  // Save to disk for offline inspection if SAVE_BINARIES_DIR is set
  if (SAVE_DIR) {
    const ext = mime.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "bin";
    const ts = Date.now();
    try { writeFileSync(`${SAVE_DIR}/binary_${ts}.${ext}`, Buffer.from(attachment, "base64")); } catch {}
  }

  // ── Post-decode: determine ACTUAL type from magic bytes (trust over mime) ──
  const isConfirmedImage = sniffImage(buffer);
  const isConfirmedText = !isConfirmedImage && sniffText(buffer);
  const isConfirmedJson = !isConfirmedImage && sniffJson(buffer);

  // Post-decode size limits based on actual type
  const postLimit = isConfirmedImage ? MAX_IMAGE_BYTES : MAX_BINARY_BYTES;
  if (buffer.length > postLimit) {
    console.log(`[Router] Skipping post-decode oversized ${isConfirmedImage ? "image" : "binary"} (${buffer.length} bytes, limit ${postLimit})`);
    return "skipped_large";
  }

  // ── JSON ──────────────────────────────────────────────────────────────────
  if (mime.includes("json") || isConfirmedJson) {
    const text = tryParseJson(buffer);
    if (text) {
      const truncated = truncate(text, MAX_TEXT_CHARS);
      blackboard.addBinaryContent(`[JSON attachment]:\n${truncated}`);
      console.log(`[Router] JSON binary decoded (${buffer.length} bytes, ${text.length} chars)`);
      return "json";
    }
  }

  // ── Plain text / HTML / XML ───────────────────────────────────────────────
  if (mime.includes("text/") || isConfirmedText) {
    const text = buffer.toString("utf-8").trim();
    if (text && !isNoise(text)) {
      const truncated = truncate(text, MAX_TEXT_CHARS);
      blackboard.addBinaryContent(`[Text attachment]:\n${truncated}`);
      console.log(`[Router] Text binary decoded (${buffer.length} bytes, ${text.length} chars)`);
      return "text";
    }
    return "noise";
  }

  // ── Confirmed image (magic bytes) ─────────────────────────────────────────
  if (isConfirmedImage) {
    if (!visionAnalyze) {
      console.log("[Router] Image detected but no vision analyzer configured — skipping");
      return "skipped_image";
    }
    const actualMime = mime.includes("image/") ? mime : inferImageMime(buffer);
    const analysis = await visionAnalyze(buffer, actualMime);
    if (analysis) {
      blackboard.addBinaryContent(`[Image analysis]:\n${analysis}`);
      console.log(`[Router] Image analyzed (${buffer.length} bytes)`);
      return "image";
    }
    return "skipped_image";
  }

  console.log(`[Router] Unknown binary type (mime="${mime}", ${buffer.length} bytes) — skipping`);
  return "unknown_binary";
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const isNoise = (text) => {
  if (text.length < 3) return true;
  if (/^[\s\-_=~.*#\u2022]+$/.test(text)) return true;
  if (/^(noise|static|silence|bzz|szum|szumy|brak sygnału|no signal)/i.test(text)) return true;
  return false;
};

const truncate = (text, maxChars) => {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `\n...[truncated, ${text.length - maxChars} chars omitted]`;
};

const sniffJson = (buf) => {
  const start = buf.slice(0, 3).toString("utf-8").trimStart()[0];
  return start === "{" || start === "[";
};

const sniffText = (buf) => {
  const sample = buf.slice(0, Math.min(256, buf.length));
  let printable = 0;
  for (const b of sample) {
    if ((b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d) printable++;
  }
  return printable / sample.length > 0.85;
};

const sniffImage = (buf) => {
  if (buf.length < 4) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
  if (buf[0] === 0xff && buf[1] === 0xd8) return true; // JPEG
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true; // GIF
  if (buf.length >= 12 && buf.slice(8, 12).toString("ascii") === "WEBP") return true;
  return false;
};

const inferImageMime = (buf) => {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  return "image/png";
};

const tryParseJson = (buf) => {
  try {
    const obj = JSON.parse(buf.toString("utf-8"));
    return JSON.stringify(obj, null, 2);
  } catch {
    return null;
  }
};
