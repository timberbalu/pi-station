import { spawn, type ChildProcess } from 'node:child_process';

import type { Logger } from 'pino';

import type { AudioChunkRecord } from '../types.js';

export interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

export interface WhisperSegment {
  start: number; // seconds, session-relative after transcribeSession
  end: number; // seconds, session-relative after transcribeSession
  text: string;
  words: WhisperWord[];
}

export interface WhisperResult {
  segments: WhisperSegment[];
  language: string;
}

/** Minimal contract VoiceComponent depends on — lets tests stub the batch path. */
export interface BatchTranscriber {
  transcribeSession(
    sessionId: string,
    chunks: AudioChunkRecord[],
    sessionStartMs: number,
  ): Promise<WhisperSegment[]>;
}

/** Injectable so tests drive the subprocess without Python or faster-whisper. */
export type SpawnLike = (command: string, args: readonly string[]) => ChildProcess;

const DEFAULT_FILE_TIMEOUT_MS = 120_000;

function emptyResult(): WhisperResult {
  return { segments: [], language: 'en' };
}

/**
 * Post-session batch STT via faster-whisper (CLI `scripts/transcribe.py`).
 *
 * Not a live streaming provider — it runs on the buffered WAV chunks after
 * `stopSession()`. This is the offline transcript guarantee: a usable transcript
 * exists even if ElevenLabs was unreachable for the whole event. It never throws:
 * any failure (spawn error, non-zero exit, timeout, bad JSON) is logged and yields
 * zero segments so the session still completes and the report still generates.
 */
export class FasterWhisperProvider implements BatchTranscriber {
  private readonly spawnImpl: SpawnLike;

  constructor(
    private readonly scriptPath: string,
    private readonly model: string,
    private readonly venvPython: string,
    private readonly timeoutMultiplier: number,
    private readonly logger: Logger,
    spawnImpl: SpawnLike = spawn,
  ) {
    this.spawnImpl = spawnImpl;
  }

  /** Transcribe one WAV file. Returns chunk-relative segments (seconds). Never throws. */
  async transcribeFile(wavPath: string, timeoutMs: number = DEFAULT_FILE_TIMEOUT_MS): Promise<WhisperResult> {
    return await new Promise<WhisperResult>((resolve) => {
      let child: ChildProcess;
      try {
        child = this.spawnImpl(this.venvPython, [this.scriptPath, wavPath, '--model', this.model]);
      } catch (error) {
        this.logger.error({ error, wavPath }, '[whisper] failed to spawn — faster-whisper not installed? pip install faster-whisper');
        resolve(emptyResult());
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (result: WhisperResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        this.logger.warn({ wavPath, timeoutMs }, '[whisper] transcription timed out — killing subprocess');
        try {
          child.kill('SIGKILL');
        } catch {
          // already gone
        }
        finish(emptyResult());
      }, timeoutMs);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('error', (error: Error) => {
        this.logger.error({ error, wavPath }, '[whisper] subprocess error — faster-whisper not installed? pip install faster-whisper');
        finish(emptyResult());
      });

      child.on('close', (code: number | null) => {
        if (code !== 0) {
          this.logger.warn({ code, wavPath, stderr: stderr.slice(0, 500) }, '[whisper] subprocess exited non-zero');
          finish(emptyResult());
          return;
        }
        finish(this.parseOutput(stdout, wavPath));
      });
    });
  }

  /**
   * Transcribe all chunks for a session in chunk order, shifting each segment's
   * timestamps to be session-relative (chunk.startMs is already session-relative,
   * so we add it). Returns segments in chronological order. Never throws.
   */
  async transcribeSession(
    sessionId: string,
    chunks: AudioChunkRecord[],
    sessionStartMs: number,
  ): Promise<WhisperSegment[]> {
    this.logger.info(
      { sessionId, sessionStartMs, chunkCount: chunks.length, model: this.model },
      '[whisper] batch transcribing session',
    );

    const ordered = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
    const all: WhisperSegment[] = [];

    for (const chunk of ordered) {
      const durationMs = Math.max(0, chunk.endMs - chunk.startMs);
      const timeoutMs = Math.max(30_000, Math.round(durationMs * this.timeoutMultiplier));
      const result = await this.transcribeFile(chunk.path, timeoutMs);
      const offsetSec = chunk.startMs / 1000;

      for (const seg of result.segments) {
        all.push({
          start: seg.start + offsetSec,
          end: seg.end + offsetSec,
          text: seg.text,
          words: seg.words.map((w) => ({ word: w.word, start: w.start + offsetSec, end: w.end + offsetSec })),
        });
      }
    }

    return all;
  }

  private parseOutput(stdout: string, wavPath: string): WhisperResult {
    try {
      const parsed = JSON.parse(stdout) as {
        segments?: Array<{ start?: number; end?: number; text?: string; words?: Array<{ word?: string; start?: number; end?: number }> }>;
        language?: string;
        error?: string;
      };

      if (parsed.error) {
        this.logger.error({ wavPath, error: parsed.error }, '[whisper] transcribe.py reported an error');
        return emptyResult();
      }

      const segments: WhisperSegment[] = (parsed.segments ?? []).map((seg) => ({
        start: Number(seg.start ?? 0),
        end: Number(seg.end ?? 0),
        text: String(seg.text ?? '').trim(),
        words: (seg.words ?? []).map((w) => ({
          word: String(w.word ?? ''),
          start: Number(w.start ?? 0),
          end: Number(w.end ?? 0),
        })),
      }));

      return { segments, language: parsed.language ?? 'en' };
    } catch (error) {
      this.logger.error({ error, wavPath, stdout: stdout.slice(0, 500) }, '[whisper] failed to parse transcribe.py output');
      return emptyResult();
    }
  }
}
