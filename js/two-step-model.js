// Two-step sign-in (an authenticator app's 6-digit codes), turned on from the Account page. Pure
// functions, no page code, so they're tested on their own (tests/two-step-model.test.mjs). The
// database shows someone who turned it on nothing until their session has used the code
// (supabase/migrations/…_two_step_sign_in.sql); the app asks for the code too (TwoStep in the app).

/** The 6-digit code from what was typed (spaces and dashes ignored), or null when it isn't one. */
export function cleanCode(text) {
  const digits = String(text ?? "").replace(/[\s-]/g, "");
  return /^[0-9]{6}$/.test(digits) ? digits : null;
}

/** Whether to ask for the code: two-step is on (the next level is aal2) and this session hasn't used it. */
export const needsCode = (level) => level?.nextLevel === "aal2" && level?.currentLevel !== "aal2";

/** The person's verified authenticator, from listFactors(); null when two-step is off. */
export const verifiedFactor = (factors) => (factors?.totp ?? []).find((factor) => factor.status === "verified") ?? null;

/** Set-ups that were started and never confirmed, which have to go before a new one. */
export const unfinishedFactors = (factors) => (factors?.all ?? []).filter((factor) => factor.status !== "verified");

export const WRONG_CODE = "That code didn't work. Check your authenticator app and try again.";
export const NOT_A_CODE = "Enter the 6-digit code from your authenticator app.";
