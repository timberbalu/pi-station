export const stationStates = [
  'IDLE',
  'PAIRING',
  'READY',
  'RECORDING',
  'OFFLINE_BUFFERING',
  'SYNCING',
  'PAUSED',
  'STOPPING',
  'REPORT_READY',
  'ERROR',
] as const;

export type StationState = typeof stationStates[number];
export type SessionEventLevel = 'info' | 'warn' | 'error';
export type RelayQueueStatus = 'pending' | 'sending' | 'sent' | 'dead';
export type AudioChunkStatus = 'open' | 'closed' | 'repaired' | 'error';

export interface SessionRecord {
  id: string;
  sessionCode: string;
  title: string;
  state: StationState;
  stationToken: string;
  ingestUrl: string;
  startedAt: string | null;
  stoppedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AudioChunk {
  pcm: Buffer;
  timestamp: Date;
  durationMs: number;
  levelDb?: number;
}

export interface TranscriptPartial {
  text: string;
  speakerLabel: string | null;
  receivedAt: string;
}

export interface TranscriptCommit {
  id: string;
  sessionId: string;
  sequence: number;
  provider: string;
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel: string | null;
  languageCode: string;
  confidence: number;
  raw: Record<string, unknown>;
  committedAt: string;
}

export interface TranscriptSegmentRecord extends TranscriptCommit {
  createdAt: string;
}

export interface RelayQueueRecord {
  id: string;
  sessionId: string;
  segmentId: string;
  sequence: number;
  payloadJson: string;
  status: RelayQueueStatus;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AudioChunkRecord {
  id: string;
  sessionId: string;
  chunkIndex: number;
  path: string;
  startMs: number;
  endMs: number;
  bytes: number;
  sampleRate: number;
  channels: number;
  status: AudioChunkStatus;
  createdAt: string;
  closedAt: string | null;
}

export interface SessionEventRecord {
  id: string;
  sessionId: string | null;
  type: string;
  level: SessionEventLevel;
  message: string;
  payloadJson: string;
  createdAt: string;
}

export interface InsightMarkRecord {
  id: string;
  sessionId: string;
  atMs: number;
  beforeMs: number;
  afterMs: number;
  note: string | null;
  transcriptExcerpt: string | null;
  createdAt: string;
}

export interface IngestPayload {
  station_id: string;
  session_id: string;
  segment_id: string;
  sequence: number;
  start_ms: number;
  end_ms: number;
  text: string;
  speaker_label: string | null;
  language_code: string;
  committed_at: string;
  source: 'meetpaper_station';
  provider: string;
  raw: Record<string, unknown>;
}

export interface SessionSummary {
  sessionId: string;
  sessionCode: string;
  title: string;
  stationToken: string;
  ingestUrl: string;
  startedAt: string | null;
  stoppedAt: string | null;
}

export interface ComponentStatusSummary {
  id: string;
  label: string;
  healthy: boolean;
  buffering: boolean;
  queued_items: number;
  detail: Record<string, unknown>;
}

export interface StationStatusResponse {
  station_id: string;
  station_name: string;
  version: string;
  state: StationState;
  session: {
    session_id: string | null;
    session_code: string | null;
    title: string | null;
    started_at: string | null;
    elapsed_ms: number;
  };
  recording: boolean;
  mic: {
    available: boolean;
    source: string;
    device: string;
    sample_rate: number;
    channels: number;
    level_db: number | null;
  };
  stt: {
    provider: string;
    connected: boolean;
    last_partial_at: string | null;
    last_commit_at: string | null;
    committed_segments: number;
    current_partial: string | null;
  };
  relay: {
    ingest_url: string;
    connected: boolean;
    queued_segments: number;
    sent_segments: number;
    dead_segments: number;
    last_flush_at: string | null;
    last_error: string | null;
  };
  buffer: {
    audio_chunks: number;
    seconds_safe: number;
    bytes: number;
    current_chunk_path: string | null;
  };
  hardware: {
    enabled: boolean;
    controller: string;
    last_state: string;
  };
  /** Each registered component's live status. */
  components: ComponentStatusSummary[];
  last_events: SessionEventRecord[];
}

export interface SessionReport {
  session_id: string;
  title: string;
  started_at: string | null;
  stopped_at: string | null;
  duration_ms: number;
  station_id: string;
  summary: {
    headline: string;
    note: string;
  };
  transcript: TranscriptSegmentRecord[];
  insight_marks: InsightMarkRecord[];
  health: {
    audio_gaps: number;
    transcript_segments: number;
    queued_segments_remaining: number;
    network_interruptions: number;
    stt_interruptions: number;
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}
