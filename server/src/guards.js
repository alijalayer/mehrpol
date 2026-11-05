/** Small, dependency-free helpers for request hardening. */

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function requireUser(req) {
  if (!req.user) throw new HttpError(401, 'ابتدا وارد حساب خود شوید');
  return req.user;
}

export function requireAdmin(req) {
  const user = requireUser(req);
  if (user.role !== 'admin') throw new HttpError(403, 'دسترسی ندارید');
  return user;
}

/** Senior managers («مدیر ارشد»): everything an admin can do, plus the team, settings and income. */
export function requireOwner(req) {
  const user = requireAdmin(req);
  if (!user.is_owner) throw new HttpError(403, 'این بخش فقط برای مدیر ارشد است');
  return user;
}

/** Fixed-window rate limiter kept in memory (one process). */
export class RateLimiter {
  #hits = new Map();

  /** Returns true when the key is still within `limit` hits per `windowMs`. */
  take(key, limit, windowMs) {
    const now = Date.now();
    const entry = this.#hits.get(key);
    if (!entry || entry.reset <= now) {
      this.#hits.set(key, { count: 1, reset: now + windowMs });
      if (this.#hits.size > 50_000) this.#sweep(now);
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  }

  #sweep(now) {
    for (const [k, v] of this.#hits) if (v.reset <= now) this.#hits.delete(k);
  }
}

const SIGNATURES = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
];

/** Detects the real file type from its bytes; the client-declared type is ignored. */
export function sniffFile(buffer) {
  return SIGNATURES.find((s) => buffer.length >= 12 && s.test(buffer)) ?? null;
}
