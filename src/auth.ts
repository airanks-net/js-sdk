// Shared AIR auth resolution — identical to every other AIR client (node-cli, rust-cli, go-cli,
// the PHP composer package): AIR_API_KEY env > ~/.config/air/auth.json > anonymous. Logging in
// with `air login` (any client) authenticates this SDK too. See API-CONTRACT.md.
//
// Node only touches the filesystem. In a browser this module never reads env vars or disk —
// callers there must pass an explicit apiKey.

export type AuthSource = 'env' | 'file' | 'explicit' | 'anonymous';

export interface ResolvedAuth {
  token: string | null;
  source: AuthSource;
  /** Host the token was saved for (file-sourced only) — the attach rule below. */
  host: string | null;
}

// No `window` and a real Node process — the one safe, dependency-free way to tell the two
// runtimes apart (Deno/Bun/Electron-renderer edge cases aren't a target here).
export const isNode =
  typeof process !== 'undefined' &&
  typeof process.versions?.node === 'string' &&
  typeof window === 'undefined';

/** Node-only: AIR_API_KEY env, then ~/.config/air/auth.json, else anonymous. */
export async function resolveNodeToken(): Promise<ResolvedAuth> {
  if (!isNode) return { token: null, source: 'anonymous', host: null };

  const envKey = process.env.AIR_API_KEY;
  if (envKey) return { token: envKey, source: 'env', host: null };

  try {
    // Built as literal-but-not-statically-joined specifiers so browser bundlers never try to
    // resolve node:fs/os/path for this codepath (it's guarded by isNode and never runs there).
    const fs = await import('node:' + 'fs');
    const os = await import('node:' + 'os');
    const path = await import('node:' + 'path');
    const authPath = path.join(os.homedir(), '.config', 'air', 'auth.json');
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    if (auth?.token) {
      return { token: auth.token, source: 'file', host: auth.host ?? null };
    }
  } catch {
    // No file, unreadable, or bad JSON — anonymous.
  }
  return { token: null, source: 'anonymous', host: null };
}

/**
 * A file-sourced token only rides to requests whose URL host equals the host it was saved for;
 * an env or explicitly-passed token is explicit intent and always attaches. Guards against a
 * saved token leaking if apiBase ever points somewhere other than where the user logged in.
 */
export function shouldAttachToken(url: string, resolved: ResolvedAuth): boolean {
  if (!resolved.token) return false;
  if (resolved.source !== 'file') return true;
  if (!resolved.host) return false;
  try {
    return new URL(url).host === resolved.host;
  } catch {
    return false;
  }
}
