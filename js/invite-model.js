// Sign-in links from invitation emails. The `people` server function emails a one-time link to the
// welcome page (welcome.html#token_hash=…&type=recovery), which opens the app with the same token
// or lets the person choose a password there. Pure functions, no page code, so they're tested on
// their own (tests/invite-model.test.mjs). The app reads the same link (SignInLink).

const LINK_TYPES = ["recovery", "invite", "magiclink"];

/** The token in a link's fragment ("#token_hash=…&type=…"), or null when there's none. */
export function linkToken(fragment) {
  const params = {};
  for (const part of String(fragment ?? "").replace(/^#/, "").split("&")) {
    const [key, ...rest] = part.split("=");
    if (!key) continue;
    try {
      params[decodeURIComponent(key)] = decodeURIComponent(rest.join("=").replace(/\+/g, " "));
    } catch {
      return null;
    }
  }
  const token = (params.token_hash ?? "").trim();
  const type = params.type || "recovery";
  return token && LINK_TYPES.includes(type) ? { token, type } : null;
}

/** The link that opens the Field Ready app with the same token. */
export const appLink = ({ token, type }) =>
  `fieldready://welcome#token_hash=${encodeURIComponent(token)}&type=${encodeURIComponent(type)}`;

/** Plain words for a link Supabase turned down (used, expired, or never valid). */
export function linkProblem(error) {
  const text = String(error?.message ?? error ?? "");
  if (/expired|invalid|not found|already/i.test(text) || error?.status === 403 || error?.code === "otp_expired") {
    return "This link has expired or was already used. Ask whoever invited you to send a new one.";
  }
  if (/fetch|network/i.test(text)) return "Can't reach Field Ready. Check your connection and try again.";
  return text || "This link didn't work. Ask whoever invited you to send a new one.";
}

/**
 * What the server answered after Send Invite or Send Password Link, as the card shows it:
 * `kind` "new", "reset", or "owner"; `emailed`; the reason it wasn't; and the link to send by hand.
 */
export function inviteResult(answer, { kind, name, email }) {
  return {
    kind,
    name,
    email,
    emailed: answer?.emailed === true,
    problem: answer?.emailed === true ? null : answer?.emailProblem ?? "The email wasn't sent.",
    link: answer?.emailed === true ? null : answer?.link ?? null,
  };
}

/** The notice after an invite, for the top of the page. */
export function inviteNotice(result) {
  if (result.emailed) {
    return result.kind === "reset" ? `Emailed ${result.name} a link to choose a new password.` : `Invitation sent to ${result.email}.`;
  }
  return result.kind === "reset" ? `Couldn't email ${result.name}.` : `Added ${result.name}, but couldn't email them.`;
}
