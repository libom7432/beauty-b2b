import { createHash } from "node:crypto";

const attempts = new Map<string, { count: number; resetAt: number }>();
/** Per-process backstop only. Production needs a shared edge or Auth limiter. */
export function allowLocalLoginAttempt(email: string, now = Date.now()): boolean {
  const key = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  const old = attempts.get(key);
  if (old && old.resetAt > now && old.count >= 5) return false;
  attempts.set(key, { count: old && old.resetAt > now ? old.count + 1 : 1, resetAt: now + 15 * 60_000 });
  if (attempts.size > 1000) for (const [entry, value] of attempts) if (value.resetAt <= now) attempts.delete(entry);
  return true;
}
