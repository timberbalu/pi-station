import { readFileSync } from 'node:fs';

import type { Logger } from 'pino';

import type { MediaTransferRepository } from '../db/repositories.js';
import { nowIso, type ConfirmedPart, type MediaTransferRecord } from '../types.js';
import type { StationSyncClient } from './StationSyncClient.js';

export interface HttpPutResult {
  ok: boolean;
  status: number;
  etag: string | null;
}

/** Injectable so tests can drive upload success/failure without real network. */
export type HttpPut = (url: string, body: Buffer, timeoutMs: number) => Promise<HttpPutResult>;

export interface MediaUploaderDeps {
  client: StationSyncClient;
  mediaTransfer: MediaTransferRepository;
  partSize: number;
  timeoutMs: number;
  token: string;
  logger: Logger;
  httpPut?: HttpPut;
}

export interface UploadOutcome {
  ok: boolean;
  s3Key?: string;
  error?: string;
}

const defaultHttpPut: HttpPut = async (url, body, timeoutMs) => {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const etag = response.headers.get('etag');
  return { ok: response.ok, status: response.status, etag };
};

/**
 * Uploads a single media file to S3 using presigned URLs.
 * Resumable: confirmed parts are persisted in media_transfer_queue.parts_json,
 * and the S3 multipart upload_id is the resume token. On re-run, only parts with
 * partNumber greater than the highest confirmed part are requested and uploaded.
 */
export class MediaUploader {
  private readonly httpPut: HttpPut;

  constructor(private readonly deps: MediaUploaderDeps) {
    this.httpPut = deps.httpPut ?? defaultHttpPut;
  }

  totalParts(fileSize: number): number {
    return Math.max(1, Math.ceil(fileSize / this.deps.partSize));
  }

  async uploadFile(record: MediaTransferRecord): Promise<UploadOutcome> {
    const { client, mediaTransfer, partSize, timeoutMs, token, logger } = this.deps;
    const total = this.totalParts(record.fileSize);

    let confirmed = parseParts(record.partsJson);
    const maxConfirmed = confirmed.reduce((max, p) => Math.max(max, p.partNumber), 0);
    let fromPart = maxConfirmed + 1;

    // Everything already uploaded — just (re)confirm with S3.
    if (fromPart > total && record.s3UploadId) {
      return this.confirmUpload(record, confirmed);
    }

    let body: Buffer;
    try {
      body = readFileSync(record.filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'read failure';
      mediaTransfer.markError(record.id, record.attempts + 1, message, nowIso());
      return { ok: false, error: message };
    }

    const presignOpts = record.s3UploadId
      ? { uploadId: record.s3UploadId, fromPart }
      : { fromPart };
    let presigned;
    try {
      presigned = await client.presign(
        record.sessionId,
        record.s3Key,
        record.fileSize,
        partSize,
        token,
        presignOpts,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'presign failure';
      mediaTransfer.markError(record.id, record.attempts + 1, message, nowIso());
      return { ok: false, error: message };
    }

    mediaTransfer.setPresign(record.id, presigned.uploadId, nowIso());

    for (const part of presigned.parts) {
      if (part.partNumber < fromPart) {
        continue;
      }
      const start = (part.partNumber - 1) * partSize;
      const slice = body.subarray(start, start + partSize);
      const result = await this.httpPut(part.url, slice, timeoutMs);

      if (!result.ok || !result.etag) {
        const message = `part ${part.partNumber} upload failed (status ${result.status})`;
        mediaTransfer.markError(record.id, record.attempts + 1, message, nowIso());
        // Persist progress so far so the next cycle resumes from the right part.
        mediaTransfer.setParts(record.id, JSON.stringify(confirmed), 'error', nowIso());
        logger.warn({ s3Key: record.s3Key, part: part.partNumber }, '[sync] media part upload failed');
        return { ok: false, error: message };
      }

      confirmed = [...confirmed.filter((p) => p.partNumber !== part.partNumber), {
        partNumber: part.partNumber,
        etag: stripQuotes(result.etag),
      }].sort((a, b) => a.partNumber - b.partNumber);

      mediaTransfer.setParts(record.id, JSON.stringify(confirmed), 'uploading', nowIso());
      fromPart = part.partNumber + 1;
    }

    return this.confirmUpload({ ...record, s3UploadId: presigned.uploadId }, confirmed);
  }

  private async confirmUpload(record: MediaTransferRecord, confirmed: ConfirmedPart[]): Promise<UploadOutcome> {
    const { client, mediaTransfer, token } = this.deps;
    if (!record.s3UploadId) {
      return { ok: false, error: 'missing upload id at confirm' };
    }

    mediaTransfer.setParts(record.id, JSON.stringify(confirmed), 'confirming', nowIso());
    try {
      const result = await client.confirm(record.sessionId, record.s3Key, record.s3UploadId, confirmed, token);
      if (!result.confirmed) {
        mediaTransfer.markError(record.id, record.attempts + 1, 'confirm rejected', nowIso());
        return { ok: false, error: 'confirm rejected' };
      }
      mediaTransfer.markUploaded(record.id, JSON.stringify(confirmed), nowIso());
      return { ok: true, s3Key: result.s3Key };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'confirm failure';
      mediaTransfer.markError(record.id, record.attempts + 1, message, nowIso());
      return { ok: false, error: message };
    }
  }
}

function parseParts(json: string): ConfirmedPart[] {
  try {
    const parsed = JSON.parse(json) as ConfirmedPart[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stripQuotes(etag: string): string {
  return etag.replace(/^"|"$/g, '');
}
