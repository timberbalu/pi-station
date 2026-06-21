import { EventEmitter } from 'node:events';

import type { SessionEventLevel, StationState, TranscriptCommit, TranscriptPartial } from '../types.js';

interface StateChangedEvent {
  from: StationState;
  to: StationState;
  at: string;
}

interface SessionEventMessage {
  sessionId: string | null;
  type: string;
  level: SessionEventLevel;
  message: string;
  payload?: Record<string, unknown>;
}

type SessionEventListener = (event: SessionEventMessage) => void;
type StateChangeListener = (event: StateChangedEvent) => void;
type PartialListener = (partial: TranscriptPartial) => void;
type CommitListener = (commit: TranscriptCommit) => void;

const STATE_CHANGED = 'state_changed';
const SESSION_EVENT = 'session_event';
const PARTIAL = 'transcript_partial';
const COMMIT = 'transcript_commit';

export class StationEventBus {
  private readonly emitter = new EventEmitter();

  emitStateChanged(event: StateChangedEvent): void {
    this.emitter.emit(STATE_CHANGED, event);
  }

  onStateChanged(listener: StateChangeListener): void {
    this.emitter.on(STATE_CHANGED, listener);
  }

  emitSessionEvent(event: SessionEventMessage): void {
    this.emitter.emit(SESSION_EVENT, event);
  }

  onSessionEvent(listener: SessionEventListener): void {
    this.emitter.on(SESSION_EVENT, listener);
  }

  emitTranscriptPartial(partial: TranscriptPartial): void {
    this.emitter.emit(PARTIAL, partial);
  }

  onTranscriptPartial(listener: PartialListener): void {
    this.emitter.on(PARTIAL, listener);
  }

  emitTranscriptCommit(commit: TranscriptCommit): void {
    this.emitter.emit(COMMIT, commit);
  }

  onTranscriptCommit(listener: CommitListener): void {
    this.emitter.on(COMMIT, listener);
  }
}
