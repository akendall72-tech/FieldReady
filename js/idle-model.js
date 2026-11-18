// When the website signs someone out for not using it (2026-11-30, from the 2026-11-10 review): a
// computer left signed in doesn't stay open to the dealer's records. Pure functions, so they're
// tested on their own (tests/idle-model.test.mjs); js/main.js keeps the time and signs out.

/** Hours without using the website before it signs out. */
export const IDLE_HOURS = 12;

/** Whether the last use (a time in milliseconds, or nothing recorded) was too long before `now`. */
export function idleTooLong(lastActive, now = Date.now()) {
  return Number.isFinite(lastActive) && lastActive > 0 && now - lastActive > IDLE_HOURS * 60 * 60 * 1000;
}

/**
 * The latest use: the time this browser last noted, or the session's own sign-in (a fresh sign-in
 * counts as use, wherever it happened), whichever is later. NaN when neither is known.
 */
export function lastUse(noted, signedInAt) {
  const times = [Number(noted), Date.parse(signedInAt ?? "")].filter((t) => Number.isFinite(t) && t > 0);
  return times.length ? Math.max(...times) : NaN;
}

/** What the sign-in screen says afterwards. */
export const IDLE_MESSAGE = `You were signed out after ${IDLE_HOURS} hours without using Field Ready. Sign in again to carry on.`;
