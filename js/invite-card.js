// The card shown after Send Invite or Send Password Link (People & stores, Customers & machines):
// that the email went, or why it didn't and the link to send by hand. Results come from
// inviteResult in invite-model.js.

import { escape } from "./ui.js";

export function inviteCard(result) {
  if (!result) return "";
  const name = escape(result.name);
  if (result.emailed) {
    return `
      <div class="card handover" role="status">
        <h2>${result.kind === "reset" ? "Password link sent" : "Invitation sent"}</h2>
        <p>Field Ready emailed ${name} at <strong>${escape(result.email)}</strong> a link to choose
          ${result.kind === "reset" ? "a new" : "their"} password. The link works once. If it expires or doesn't arrive,
          use <strong>Send Password Link</strong>.</p>
        <button class="link" data-action="dismiss-handover">Done</button>
      </div>`;
  }
  return `
    <div class="card handover warning" role="status">
      <h2>Couldn't email ${name}</h2>
      <p>${escape(result.problem)}</p>
      ${result.link ? `
        <p>${result.kind === "reset" ? "" : "Their login is ready. "}Send them this link yourself (email or text). It works once and lets
          them choose their password:</p>
        <p class="invite-link"><code>${escape(result.link)}</code>
          <button class="secondary" data-action="copy-link">Copy Link</button></p>
        <p class="hint">It isn't shown again once you close this.</p>` : `
        <p>${result.kind === "reset" ? "" : "Their login is ready. "}Try <strong>Send Password Link</strong> in a moment.</p>`}
      <button class="link" data-action="dismiss-handover">Done</button>
    </div>`;
}

/** Copies the card's link, and says so on the button. */
export async function copyLink(button, result) {
  try {
    await navigator.clipboard.writeText(result?.link ?? "");
    button.textContent = "Copied";
  } catch {
    button.textContent = "Select and copy it";
  }
}
