import type { ConfirmedPart } from '../types.js';

export interface SessionManifest {
  session_id: string;
  session_code: string;
  title: string;
  station_id: string;
  started_at: string | null;
  stopped_at: string | null;
  components: string[];
}

export interface ManifestResult {
  accepted: boolean;
  existing: boolean;
}

export interface PresignedPart {
  partNumber: number;
  url: string;
}

export interface PresignResult {
  uploadId: string;
  parts: PresignedPart[];
}

export interface PresignOptions {
  /** Resume an existing multipart upload instead of starting a new one. */
  uploadId?: string;
  /** Request presigned URLs only for parts with partNumber >= fromPart. */
  fromPart?: number;
}

export interface ConfirmResult {
  confirmed: boolean;
  s3Key: string;
}

/**
 * Talks to the apm/PHP station endpoints (or the Pi's own mock endpoints in mock mode).
 * The Pi never holds AWS credentials — it only exchanges small JSON coordination requests.
 */
export interface StationSyncClient {
  manifest(manifest: SessionManifest, token: string): Promise<ManifestResult>;
  presign(
    sessionId: string,
    key: string,
    fileSize: number,
    partSize: number,
    token: string,
    opts?: PresignOptions,
  ): Promise<PresignResult>;
  confirm(
    sessionId: string,
    key: string,
    uploadId: string,
    parts: ConfirmedPart[],
    token: string,
  ): Promise<ConfirmResult>;
  syncComplete(sessionId: string, componentsSynced: string[], token: string): Promise<boolean>;
}

export class HttpStationSyncClient implements StationSyncClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async manifest(manifest: SessionManifest, token: string): Promise<ManifestResult> {
    const response = await this.post(`/sessions`, manifest, token);
    if (response.status === 409) {
      return { accepted: true, existing: true };
    }
    if (!response.ok) {
      throw new Error(`manifest failed: ${response.status}`);
    }
    const body = await response.json().catch(() => ({})) as { existing?: boolean };
    return { accepted: true, existing: Boolean(body.existing) };
  }

  async presign(
    sessionId: string,
    key: string,
    fileSize: number,
    partSize: number,
    token: string,
    opts: PresignOptions = {},
  ): Promise<PresignResult> {
    const params = new URLSearchParams({
      key,
      file_size: String(fileSize),
      part_size: String(partSize),
    });
    if (opts.uploadId) {
      params.set('upload_id', opts.uploadId);
    }
    if (opts.fromPart) {
      params.set('from_part', String(opts.fromPart));
    }

    const response = await this.get(`/sessions/${sessionId}/media/presign?${params.toString()}`, token);
    if (!response.ok) {
      throw new Error(`presign failed: ${response.status}`);
    }
    const body = await response.json() as {
      upload_id: string;
      parts: Array<{ part_number: number; presigned_url: string }>;
    };
    return {
      uploadId: body.upload_id,
      parts: body.parts.map((p) => ({ partNumber: p.part_number, url: p.presigned_url })),
    };
  }

  async confirm(
    sessionId: string,
    key: string,
    uploadId: string,
    parts: ConfirmedPart[],
    token: string,
  ): Promise<ConfirmResult> {
    const response = await this.post(`/sessions/${sessionId}/media/confirm`, {
      key,
      upload_id: uploadId,
      parts: parts.map((p) => ({ part_number: p.partNumber, etag: p.etag })),
    }, token);
    if (!response.ok) {
      throw new Error(`confirm failed: ${response.status}`);
    }
    const body = await response.json() as { confirmed: boolean; s3_key: string };
    return { confirmed: Boolean(body.confirmed), s3Key: body.s3_key };
  }

  async syncComplete(sessionId: string, componentsSynced: string[], token: string): Promise<boolean> {
    const response = await this.post(`/sessions/${sessionId}/sync-complete`, {
      components_synced: componentsSynced,
    }, token);
    if (!response.ok) {
      throw new Error(`sync-complete failed: ${response.status}`);
    }
    return true;
  }

  private async post(path: string, body: unknown, token: string): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private async get(path: string, token: string): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }
}
