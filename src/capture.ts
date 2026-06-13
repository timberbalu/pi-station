/**
 * pi-capture — audio daemon
 *
 * Opens the USB microphone via arecord (ALSA), streams PCM audio chunks
 * to the ElevenLabs Scribe v2 WebSocket, writes a rolling WAV buffer to
 * disk, and emits committed transcript segments via an EventEmitter for
 * pi-relay to pick up.
 *
 * On the Pi: arecord is part of alsa-utils (sudo apt install alsa-utils)
 * On Mac dev: swap arecord for sox or ffmpeg for local testing
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, createWriteStream, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import { config } from './config.js';

export interface TranscriptSegment {
  speaker_id:  string;
  text:        string;
  start_ms:    number;
  end_ms:      number;
  confidence:  number;
  captured_at: string; // ISO timestamp — original capture time, not delivery time
}

export class CaptureService extends EventEmitter {
  private arecord:   ChildProcess | null = null;
  private ws:        WebSocket    | null = null;
  private wavStream: WriteStream  | null = null;
  private chunkIndex = 0;
  private sessionStartMs = 0;

  get isRecording(): boolean { return this.arecord !== null; }

  start(): void {
    if (this.isRecording) return;

    mkdirSync(config.buffer.dir, { recursive: true });
    this.sessionStartMs = Date.now();
    this.chunkIndex = 0;

    this._openWavChunk();
    this._connectElevenLabs();

    // arecord: 16kHz mono PCM — ElevenLabs Scribe v2 optimal format
    // Device 'plughw:1,0' is typical for a USB mic on Pi; adjust as needed
    this.arecord = spawn('arecord', [
      '--device=plughw:1,0',
      '--format=S16_LE',
      '--rate=16000',
      '--channels=1',
      '--file-type=raw',
      '-',            // stdout
    ]);

    this.arecord.stdout?.on('data', (chunk: Buffer) => {
      // 1. Forward to ElevenLabs WS
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(chunk);
      }
      // 2. Write to local WAV buffer
      this.wavStream?.write(chunk);
    });

    this.arecord.on('error', (err) => {
      console.error('[capture] arecord error:', err.message);
      this.emit('error', err);
    });

    console.log('[capture] Recording started');
    this.emit('started');
  }

  stop(): void {
    this.arecord?.kill('SIGTERM');
    this.arecord = null;
    this.ws?.close();
    this.ws = null;
    this.wavStream?.end();
    this.wavStream = null;
    console.log('[capture] Recording stopped');
    this.emit('stopped');
  }

  pause(): void {
    this.arecord?.kill('SIGSTOP');
    this.ws?.close();
    this.ws = null;
    console.log('[capture] Paused');
    this.emit('paused');
  }

  resume(): void {
    this.arecord?.kill('SIGCONT');
    this._connectElevenLabs();
    console.log('[capture] Resumed');
    this.emit('resumed');
  }

  // ── private ──────────────────────────────────────────────────────────────

  private _connectElevenLabs(): void {
    const ws = new WebSocket(config.elevenlabs.wsUrl, {
      headers: { 'xi-api-key': config.elevenlabs.apiKey },
    });

    ws.on('open', () => {
      console.log('[capture] ElevenLabs WS connected');
      // Send session config expected by Scribe v2 streaming API
      ws.send(JSON.stringify({
        sample_rate: 16000,
        encoding:    'pcm_s16le',
        language:    'en',
        diarize:     true,
      }));
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg['type'] === 'transcript' && msg['is_final'] === true) {
          const segment: TranscriptSegment = {
            speaker_id:  String(msg['speaker_id']  ?? 'SPEAKER_0'),
            text:        String(msg['text']         ?? ''),
            start_ms:    Number(msg['start_ms']     ?? 0),
            end_ms:      Number(msg['end_ms']       ?? 0),
            confidence:  Number(msg['confidence']   ?? 1),
            captured_at: new Date().toISOString(),
          };
          this.emit('segment', segment);
        }
      } catch { /* ignore non-JSON frames */ }
    });

    ws.on('close',  () => console.log('[capture] ElevenLabs WS closed'));
    ws.on('error', (err) => {
      console.error('[capture] ElevenLabs WS error:', err.message);
      // Reconnect after 2s if still recording
      if (this.isRecording) {
        setTimeout(() => this._connectElevenLabs(), 2000);
      }
    });

    this.ws = ws;
  }

  private _openWavChunk(): void {
    this.wavStream?.end();
    const filename = `chunk-${String(this.chunkIndex++).padStart(4, '0')}.raw`;
    this.wavStream = createWriteStream(join(config.buffer.dir, filename));
    // Rotate every 30 s
    setTimeout(() => {
      if (this.isRecording) this._openWavChunk();
    }, 30_000);
  }
}

export const captureService = new CaptureService();
