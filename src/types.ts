// Shapes returned by the AIR API. See API-CONTRACT.md at the repo root.

export interface AiFiles {
  status: 'ready' | 'pending';
  llms_txt: boolean;
  llms_full_txt: boolean;
  ai_txt: boolean;
  robots_txt: boolean;
  json_ld: boolean;
  json_ld_types: string[];
  robots_ai_agents: Record<string, 'allowed' | 'blocked' | 'partial'>;
}

export interface Domain {
  hostname: string;
  /** 0-10. The server casts a not-yet-hydrated score to 0 — treat ai_files.status
   * === "pending" as "unknown", not a real zero. */
  air_score: number;
  percentile: number | null;
  tracked: boolean;
  occurrences: number;
  phrases_count: number;
  brands_count: number;
  summary: string | null;
  ai_files: AiFiles;
}

export interface ResponseMeta {
  dataset_version: number | null;
}

export interface DomainResponse {
  data: Domain;
  meta: ResponseMeta;
  /** True when polling hit pollMaxMs while ai_files.status was still "pending" —
   * data.air_score is NOT a real score in that case. */
  pendingAtCap?: boolean;
}

export interface SearchHit {
  hostname?: string;
  name?: string;
  text?: string;
  air_score: number;
}

export interface SearchResults {
  domains: SearchHit[];
  brands: SearchHit[];
  phrases: SearchHit[];
}

export interface SearchResponse {
  data: SearchResults;
  meta: ResponseMeta;
}

export interface AirUser {
  name: string;
  email: string;
}
