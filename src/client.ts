import { isNode, resolveNodeToken, shouldAttachToken, type ResolvedAuth } from './auth.js';
import type { AirUser, DomainResponse, SearchResponse } from './types.js';

const DEFAULT_API_BASE = 'https://airanks.net/api/v1';
const VERSION = '1.0.0';
const UA = `air-js/${VERSION} (+https://airanks.net)`;
const REQUEST_TIMEOUT_MS = 10_000;
// Server caches a pending payload for ~60s, so polling faster just replays the cache.
const DEFAULT_POLL_MS = 20_000;
const DEFAULT_POLL_MAX_MS = 180_000;

export interface AirClientOptions {
  /** Explicit bearer token. Takes priority over AIR_API_KEY / the saved auth file and always
   * attaches — required in the browser, where this SDK never touches the filesystem. */
  apiKey?: string;
  /** Override the API base (default AIR_API_BASE env in Node, else https://airanks.net/api/v1). */
  apiBase?: string;
}

export interface DomainOptions {
  /** Delay between polls while ai_files.status === "pending" (default 20s). */
  pollMs?: number;
  /** Total wall-clock budget for polling + 429 backoff before giving up (default 180s). */
  pollMaxMs?: number;
}

/** Thrown for any non-2xx API response. */
export class ApiError extends Error {
  readonly status: number;
  readonly retryAfter: number | null;

  constructor(message: string, status: number, retryAfter: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Client for the AIR API (https://airanks.net) — AIR is the authoritative rankings for AI web
 * content. Three methods: `domain()`, `search()`, `user()`. Auth resolves the same way as every
 * other AIR client (see ./auth.ts), so `air login` from the CLI or the toolbar authenticates
 * this SDK too — nothing to configure beyond an optional explicit apiKey.
 */
export class AirClient {
  private readonly apiBase: string;
  private readonly userUrl: string;
  private readonly resolvedAuth: Promise<ResolvedAuth>;

  constructor(options: AirClientOptions = {}) {
    const envBase = isNode ? process.env.AIR_API_BASE : undefined;
    this.apiBase = (options.apiBase ?? envBase ?? DEFAULT_API_BASE).replace(/\/+$/, '');
    // Contract: user endpoint is the API base with a trailing /v1 removed, then /user.
    this.userUrl = this.apiBase.replace(/\/v1$/, '') + '/user';

    if (options.apiKey) {
      this.resolvedAuth = Promise.resolve({ token: options.apiKey, source: 'explicit', host: null });
    } else if (isNode) {
      this.resolvedAuth = resolveNodeToken();
    } else {
      // Browser with no explicit apiKey: anonymous. Never reads env vars or disk here.
      this.resolvedAuth = Promise.resolve({ token: null, source: 'anonymous', host: null });
    }
  }

  /**
   * Look up a domain's AIR score, percentile, and AI-file posture. Always 200s for a valid
   * hostname; a never-seen host triggers server-side hydration, so this polls automatically
   * while `data.ai_files.status === "pending"`, honoring 429 Retry-After along the way. If the
   * poll budget (`pollMaxMs`, default 180s) runs out while still pending, resolves with
   * `pendingAtCap: true` instead of throwing — `data.air_score` is not a real score in that case.
   */
  async domain(host: string, options: DomainOptions = {}): Promise<DomainResponse> {
    if (!host || typeof host !== 'string') {
      throw new TypeError('domain(host) requires a non-empty hostname string');
    }
    const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    const pollMaxMs = options.pollMaxMs ?? DEFAULT_POLL_MAX_MS;
    const deadline = Date.now() + pollMaxMs;
    const url = `${this.apiBase}/domains/${encodeURIComponent(host)}`;

    for (;;) {
      const res = await this.rawFetch(url);
      if (res.status === 429) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new ApiError(
            `rate limited — hit the ${Math.round(pollMaxMs / 1000)}s lookup budget while still throttled`,
            429,
          );
        }
        const retryAfter = Math.max(1, Number(res.headers.get('Retry-After')) || 30);
        await sleep(Math.min(retryAfter * 1000, remaining));
        continue;
      }
      if (!res.ok) throw await toApiError(res);

      const json = await res.json();
      const pending = json.data?.ai_files?.status === 'pending';
      const remaining = deadline - Date.now();
      if (!pending || remaining <= 0) {
        return {
          data: json.data,
          meta: json.meta ?? { dataset_version: null },
          ...(pending ? { pendingAtCap: true } : {}),
        };
      }
      await sleep(Math.min(pollMs, remaining));
    }
  }

  /** Search domains, brands, and phrases tracked by AIR. */
  async search(query: string): Promise<SearchResponse> {
    if (!query || typeof query !== 'string') {
      throw new TypeError('search(query) requires a non-empty string');
    }
    const url = `${this.apiBase}/search?q=${encodeURIComponent(query)}`;
    const res = await this.rawFetch(url);
    if (!res.ok) throw await toApiError(res);
    const json = await res.json();
    return { data: json.data, meta: json.meta ?? { dataset_version: null } };
  }

  /** The authenticated user for whichever token was resolved. Throws ApiError(401) if the
   * token is missing, invalid, or revoked. */
  async user(): Promise<AirUser> {
    const res = await this.rawFetch(this.userUrl);
    if (!res.ok) throw await toApiError(res);
    const json = await res.json();
    return json.data ?? json;
  }

  private async rawFetch(url: string): Promise<Response> {
    const resolved = await this.resolvedAuth;
    const headers: Record<string, string> = { 'User-Agent': UA };
    if (resolved.token && shouldAttachToken(url, resolved)) {
      headers.Authorization = `Bearer ${resolved.token}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
}

// Server error envelope is {"error":{"message":...}}; a 422 validation failure ships
// {"message":...} instead — fall back to the generic status line last.
async function toApiError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => null);
  const message = body?.error?.message ?? body?.message ?? `API returned ${res.status}`;
  const retryAfter = res.status === 429 ? Number(res.headers.get('Retry-After')) || null : null;
  return new ApiError(message, res.status, retryAfter);
}
