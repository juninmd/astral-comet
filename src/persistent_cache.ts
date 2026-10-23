// Persistent response cache for the FIPE v2 API (500 requests/day without a token), so reloads and new tabs reuse answers.
// FIPE publishes one table per month, so an answer stays valid until a newer reference table appears.
export interface Entry { v: unknown; t: number; /** reference table code the answer belongs to */ r?: string }

/** Minimal slice of chrome.storage.local, injectable for tests. */
export interface Backend {
  get(keys: string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export const FRESH_MS = 3 * 24 * 3600 * 1000;      // fallback while the current reference table is unknown
export const REFERENCE_CHECK_MS = 12 * 3600 * 1000; // how often to ask which table is current
export const STALE_MAX_MS = 45 * 24 * 3600 * 1000; // an old answer still beats an error screen
export const COOLDOWN_MS = 5 * 60 * 1000;          // after a 429 the daily quota is spent; stop spending requests
export const MAX_ENTRIES = 1500;                   // ~300 B each, well under the 10 MB storage quota

const PREFIX = 'fipe-cache:';
const COOLDOWN_KEY = `${PREFIX}cooldown`;
const REFERENCE_KEY = `${PREFIX}reference`;
export const USAGE_KEY = `${PREFIX}usage`;

interface Cooldown { until: number; authed: boolean }
interface Reference { code: string; at: number }
/** Requests this extension sent to the FIPE API on a local day (approximate: other apps share the quota). */
export interface Usage { day: string; anon: number; token: number }

export function chromeBackend(): Backend | null {
  const area = (globalThis as { chrome?: { storage?: { local?: Backend } } }).chrome?.storage?.local;
  return area ?? null;
}

const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Today's request count, for the popup. */
export async function readUsage(backend: Backend, now = Date.now()): Promise<Usage> {
  const empty = { day: localDay(now), anon: 0, token: 0 };
  try {
    const raw = (await backend.get([USAGE_KEY]))[USAGE_KEY] as Usage | undefined;
    return raw?.day === empty.day ? { ...empty, anon: raw.anon || 0, token: raw.token || 0 } : empty;
  } catch {
    return empty;
  }
}

export class PersistentCache {
  private entries = new Map<string, Entry>();
  private cooldown: Cooldown | null = null;
  private reference: Reference | null = null;
  private loading: Promise<void> | null = null;
  private usageChain: Promise<void> = Promise.resolve();

  constructor(private backend: Backend, private now: () => number = Date.now) {}

  /** Loads the stored entries once, dropping the unusable ones. Storage failures degrade to "no cache". */
  private load(): Promise<void> {
    this.loading ??= (async () => {
      try {
        const all = await this.backend.get(null);
        const expired: string[] = [];
        for (const [key, raw] of Object.entries(all)) {
          if (!key.startsWith(PREFIX) || key === USAGE_KEY) continue;
          if (key === COOLDOWN_KEY) { this.cooldown = raw as Cooldown; continue; }
          if (key === REFERENCE_KEY) { this.reference = raw as Reference; continue; }
          const entry = raw as Entry;
          if (typeof entry?.t === 'number' && this.now() - entry.t <= STALE_MAX_MS) this.entries.set(key, entry);
          else expired.push(key);
        }
        expired.push(...this.evict()); // other tabs may have left the store above the cap
        if (expired.length) await this.backend.remove(expired);
      } catch { /* cache is an optimisation only */ }
    })();
    return this.loading;
  }

  /** Another tab changed the shared state (cooldown, current table): follow it instead of waiting for our own 429. */
  applyChanges(changes: Record<string, { newValue?: unknown }>): void {
    if (COOLDOWN_KEY in changes) this.cooldown = (changes[COOLDOWN_KEY].newValue as Cooldown | undefined) ?? null;
    if (REFERENCE_KEY in changes) this.reference = (changes[REFERENCE_KEY].newValue as Reference | undefined) ?? this.reference;
  }

  /** The reference table to trust right now, or undefined when it was never learned or is due for a recheck. */
  private currentReference(): string | undefined {
    return this.reference && this.now() - this.reference.at < REFERENCE_CHECK_MS ? this.reference.code : undefined;
  }

  async needsReferenceCheck(): Promise<boolean> {
    await this.load();
    return this.currentReference() === undefined;
  }

  async setReference(code: string): Promise<void> {
    await this.load();
    this.reference = { code, at: this.now() };
    try { await this.backend.set({ [REFERENCE_KEY]: this.reference }); } catch { /* see store() */ }
  }

  /**
   * The stored value and whether it is still fresh: same reference table as the current one, or, while that is
   * unknown, younger than FRESH_MS. Undefined when absent or too old to serve even on error.
   */
  async lookup(url: string): Promise<{ value: unknown; fresh: boolean } | undefined> {
    await this.load();
    const entry = this.entries.get(PREFIX + url);
    if (!entry) return undefined;
    const age = this.now() - entry.t;
    if (age > STALE_MAX_MS) return undefined;
    const current = this.currentReference();
    // Untagged entries (stored before the table was known) fall back to the age window.
    return { value: entry.v, fresh: current && entry.r ? entry.r === current : age < FRESH_MS };
  }

  async store(url: string, value: unknown): Promise<void> {
    await this.load();
    const key = PREFIX + url;
    const entry: Entry = { v: value, t: this.now(), r: this.currentReference() };
    this.entries.set(key, entry);
    const evicted = this.evict();
    // Free space first: when the quota is full the write below is the one that fails.
    try { if (evicted.length) await this.backend.remove(evicted); } catch { /* see below */ }
    try { await this.backend.set({ [key]: entry }); } catch { /* quota or storage unavailable: keep working from memory */ }
  }

  /** Oldest entries go first once over the cap. */
  private evict(): string[] {
    const over = this.entries.size - MAX_ENTRIES;
    if (over <= 0) return [];
    const oldest = [...this.entries].sort((a, b) => a[1].t - b[1].t).slice(0, over).map(([key]) => key);
    for (const key of oldest) this.entries.delete(key);
    return oldest;
  }

  /** True while a recent 429 makes new requests pointless. A token has its own quota, so a mismatch does not count. */
  async coolingDown(authed: boolean): Promise<boolean> {
    await this.load();
    return !!this.cooldown && this.cooldown.authed === authed && this.now() < this.cooldown.until;
  }

  async startCooldown(authed: boolean): Promise<void> {
    await this.load();
    this.cooldown = { until: this.now() + COOLDOWN_MS, authed };
    try { await this.backend.set({ [COOLDOWN_KEY]: this.cooldown }); } catch { /* see store() */ }
  }

  /** Explicit "Tentar novamente": the user asked to try the network again. */
  async clearCooldown(): Promise<void> {
    await this.load();
    this.cooldown = null;
    try { await this.backend.remove([COOLDOWN_KEY]); } catch { /* see store() */ }
  }

  /** Counts one outgoing request toward today's quota estimate. */
  recordRequest(authed: boolean): Promise<void> {
    // Chained so concurrent lookups in one page do not overwrite each other's increment.
    this.usageChain = this.usageChain.then(async () => {
      try {
        const usage = await readUsage(this.backend, this.now());
        usage[authed ? 'token' : 'anon'] += 1;
        await this.backend.set({ [USAGE_KEY]: usage });
      } catch { /* see store() */ }
    });
    return this.usageChain;
  }
}
