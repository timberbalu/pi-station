import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  createRepositories,
  loadConfig,
  logger,
  MediaUploader,
  openDatabase,
} from '@pi-station/core';
import type {
  ConfirmedPart,
  ConfirmResult,
  HttpPut,
  MediaTransferRecord,
  PresignOptions,
  PresignResult,
  StationSyncClient,
} from '@pi-station/core';

class FakeSyncClient implements StationSyncClient {
  presignCalls: Array<{ fromPart?: number; uploadId?: string }> = [];

  async manifest() {
    return { accepted: true, existing: false };
  }

  async presign(
    _sessionId: string,
    _key: string,
    fileSize: number,
    partSize: number,
    _token: string,
    opts: PresignOptions = {},
  ): Promise<PresignResult> {
    this.presignCalls.push({ fromPart: opts.fromPart, uploadId: opts.uploadId });
    const total = Math.max(1, Math.ceil(fileSize / partSize));
    const from = opts.fromPart ?? 1;
    const parts = [];
    for (let n = from; n <= total; n += 1) {
      parts.push({ partNumber: n, url: `mock://part/${n}` });
    }
    return { uploadId: opts.uploadId ?? 'upload-fixed', parts };
  }

  async confirm(
    _sessionId: string,
    key: string,
    _uploadId: string,
    _parts: ConfirmedPart[],
    _token: string,
  ): Promise<ConfirmResult> {
    return { confirmed: true, s3Key: key };
  }

  async syncComplete(): Promise<boolean> {
    return true;
  }
}

describe('MediaUploader resumability', () => {
  it('resumes from the next part after a mid-upload drop', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-sync-'));
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      DATA_DIR: root,
      SQLITE_PATH: join(root, 'station.sqlite'),
      AUDIO_DIR: join(root, 'audio'),
      SYNC_PART_SIZE: '10',
    });
    const db = openDatabase(config);
    const repositories = createRepositories(db);

    // 25-byte file → 3 parts at part_size 10.
    const filePath = join(root, 'chunk.bin');
    writeFileSync(filePath, Buffer.alloc(25, 1));

    const record: MediaTransferRecord = {
      id: 'media-1',
      sessionId: 'session-1',
      mediaType: 'audio',
      filePath,
      s3Key: 'vi-media/sessions/session-1/audio/chunk-0001.wav',
      chunkIndex: 1,
      fileSize: 25,
      s3UploadId: null,
      partsJson: '[]',
      status: 'pending',
      attempts: 0,
      lastError: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    repositories.mediaTransfer.enqueue(record);

    const client = new FakeSyncClient();

    // Fail the first time part 2 is attempted; succeed on every other attempt.
    let part2Failures = 0;
    const httpPut: HttpPut = async (url) => {
      const partNumber = Number(url.split('/').pop());
      if (partNumber === 2 && part2Failures === 0) {
        part2Failures += 1;
        return { ok: false, status: 500, etag: null };
      }
      return { ok: true, status: 200, etag: `"etag-${partNumber}"` };
    };

    const uploader = new MediaUploader({
      client,
      mediaTransfer: repositories.mediaTransfer,
      partSize: config.sync.partSize,
      timeoutMs: 1000,
      token: 'tok',
      logger,
      httpPut,
    });

    // First attempt — part 1 succeeds, part 2 fails → upload incomplete.
    const first = await uploader.uploadFile(repositories.mediaTransfer.getById('media-1')!);
    expect(first.ok).toBe(false);

    const afterFirst = repositories.mediaTransfer.getById('media-1')!;
    const confirmedAfterFirst = JSON.parse(afterFirst.partsJson) as ConfirmedPart[];
    expect(confirmedAfterFirst.map((p) => p.partNumber)).toEqual([1]);
    expect(afterFirst.s3UploadId).toBe('upload-fixed');

    // Second attempt — resumes from part 2, finishes parts 2 & 3, confirms.
    const second = await uploader.uploadFile(repositories.mediaTransfer.getById('media-1')!);
    expect(second.ok).toBe(true);

    const afterSecond = repositories.mediaTransfer.getById('media-1')!;
    expect(afterSecond.status).toBe('uploaded');
    const confirmedAfterSecond = JSON.parse(afterSecond.partsJson) as ConfirmedPart[];
    expect(confirmedAfterSecond.map((p) => p.partNumber)).toEqual([1, 2, 3]);

    // The resume presign requested only the remaining parts (fromPart = 2).
    const lastPresign = client.presignCalls.at(-1);
    expect(lastPresign?.fromPart).toBe(2);
    expect(lastPresign?.uploadId).toBe('upload-fixed');

    db.close();
  });
});
