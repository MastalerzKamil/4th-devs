import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { AudioByteStream, tts } from "@livekit/agents";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import WebSocket from "ws";

const API_BASE = "wss://api.elevenlabs.io/v1";

// How long to wait for ElevenLabs to finish after the last text is sent.
const SYNTHESIS_TIMEOUT_MS = 15_000;

class ElevenLabsSynthesizeStream extends tts.SynthesizeStream {
  label = "elevenlabs-mp3.SynthesizeStream";
  #opts;

  constructor(ttsInstance, opts) {
    super(ttsInstance);
    this.#opts = opts;
  }

  async run() {
    const requestId = randomUUID();
    const segmentId = requestId;
    const byteStream = new AudioByteStream(this.#opts.sampleRate, 1);

    const url = `${API_BASE}/text-to-speech/${this.#opts.voiceId}/stream-input?model_id=${this.#opts.model}&output_format=mp3_44100_128`;
    const socket = new WebSocket(url, {
      headers: { "xi-api-key": this.#opts.apiKey },
    });

    const ffmpeg = spawn(
      ffmpegInstaller.path,
      ["-i", "pipe:0", "-f", "s16le", "-ar", String(this.#opts.sampleRate), "-ac", "1", "pipe:1"],
      { stdio: ["pipe", "pipe", "ignore"] },
    );

    let lastFrame;

    ffmpeg.stdout.on("data", (pcmChunk) => {
      const ab = pcmChunk.buffer.slice(
        pcmChunk.byteOffset,
        pcmChunk.byteOffset + pcmChunk.byteLength,
      );
      for (const frame of byteStream.write(ab)) {
        if (lastFrame)
          this.queue.put({ requestId, segmentId, frame: lastFrame, final: false });
        lastFrame = frame;
      }
    });

    const ffmpegDone = new Promise((resolve) => ffmpeg.on("close", resolve));

    let audioChunksReceived = 0;
    const wsDone = new Promise((resolve) => {
      socket.on("message", (raw) => {
        let d;
        try { d = JSON.parse(raw.toString()); } catch { return; }
        if (d.audio && d.audio.length > 10 && ffmpeg.stdin.writable) {
          audioChunksReceived++;
          ffmpeg.stdin.write(Buffer.from(d.audio, "base64"));
        } else if (!d.isFinal) {
          // Log any non-audio, non-final message (usually errors from ElevenLabs)
          console.error("[elevenlabs] unexpected message:", JSON.stringify(d));
        }
        if (d.isFinal) {
          console.log(`[elevenlabs] isFinal received — audio chunks: ${audioChunksReceived}`);
          if (ffmpeg.stdin.writable) ffmpeg.stdin.end();
          resolve();
        }
      });
      socket.on("close", (code, reason) => {
        console.log(`[elevenlabs] socket closed — code=${code} reason=${reason} audioChunks=${audioChunksReceived}`);
        if (ffmpeg.stdin.writable) ffmpeg.stdin.end();
        resolve();
      });
      socket.on("error", (err) => {
        console.error("[elevenlabs] WebSocket error:", err.message);
        if (ffmpeg.stdin.writable) ffmpeg.stdin.end();
        resolve();
      });
    });

    const closeAll = () => {
      if (socket.readyState <= WebSocket.OPEN) socket.close();
      if (ffmpeg.stdin.writable) ffmpeg.stdin.end();
    };

    this.abortSignal.addEventListener("abort", closeAll, { once: true });

    // Wait for the WebSocket to open (throws on connection error).
    await new Promise((res, rej) => {
      socket.once("open", res);
      socket.once("error", rej);
    });
    console.log("[elevenlabs] WebSocket open");

    socket.send(
      JSON.stringify({
        text: " ",
        voice_settings: this.#opts.voiceSettings,
        generation_config: { chunk_length_schedule: [50, 80, 120, 150] },
      }),
    );

    // Drain the LLM text stream with abort support.
    // The plain `for await` hangs when the livekit framework doesn't close
    // the TTS input iterator after LLM completion; Promise.race fixes that.
    const abortedPromise = new Promise((resolve) => {
      if (this.abortSignal.aborted) return resolve({ done: true });
      this.abortSignal.addEventListener("abort", () => resolve({ done: true }), { once: true });
    });

    const iter = this.input[Symbol.asyncIterator]();
    let tokenCount = 0;
    console.log("[elevenlabs] waiting for LLM tokens…");
    while (!this.abortSignal.aborted) {
      const result = await Promise.race([iter.next(), abortedPromise]);
      if (result.done) break;

      const data = result.value;
      if (data === tts.SynthesizeStream.FLUSH_SENTINEL) {
        if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ text: " ", flush: true }));
        continue;
      }
      const text = data.endsWith(" ") ? data : `${data} `;
      if (text.trim() && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ text }));
        if (tokenCount === 0) console.log("[elevenlabs] first token sent:", JSON.stringify(text));
        tokenCount++;
      }
    }
    console.log(`[elevenlabs] LLM drain done — ${tokenCount} token(s), aborted=${this.abortSignal.aborted}`);

    // Signal end-of-text to ElevenLabs.
    if (!this.abortSignal.aborted && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ text: " ", flush: true }));
      socket.send(JSON.stringify({ text: "" }));
      console.log("[elevenlabs] end-of-text sent, waiting for audio…");
    }

    // Wait for synthesis to finish, with a hard timeout so we never hang.
    const timeout = new Promise((resolve) => setTimeout(resolve, SYNTHESIS_TIMEOUT_MS));
    await Promise.race([Promise.all([wsDone, ffmpegDone]), timeout]).catch(() => {});
    console.log(`[elevenlabs] synthesis done — lastFrame=${!!lastFrame}`);

    // Safety: make sure everything is torn down after timeout.
    closeAll();
    await ffmpegDone;

    for (const frame of byteStream.flush()) {
      if (lastFrame)
        this.queue.put({ requestId, segmentId, frame: lastFrame, final: false });
      lastFrame = frame;
    }
    if (lastFrame)
      this.queue.put({ requestId, segmentId, frame: lastFrame, final: true });

    this.abortSignal.removeEventListener("abort", closeAll);
  }
}

export class ElevenLabsTTS extends tts.TTS {
  label = "elevenlabs-mp3.TTS";
  #opts;

  constructor(opts = {}) {
    const apiKey = opts.apiKey ?? process.env.ELEVEN_API_KEY;
    if (!apiKey) throw new Error("Set ELEVEN_API_KEY");

    const sampleRate = opts.sampleRate ?? 24000;
    super(sampleRate, 1, { streaming: true });

    this.#opts = {
      apiKey,
      voiceId: opts.voiceId ?? "21m00Tcm4TlvDq8ikWAM",
      model: opts.model ?? "eleven_flash_v2_5",
      sampleRate,
      voiceSettings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0,
        use_speaker_boost: true,
        speed: 1,
        ...(opts.voiceSettings ?? {}),
      },
    };
  }

  get model() {
    return this.#opts.model;
  }
  get provider() {
    return "elevenlabs";
  }

  synthesize() {
    throw new Error("Use stream() for ElevenLabs TTS");
  }
  stream() {
    return new ElevenLabsSynthesizeStream(this, this.#opts);
  }
}
