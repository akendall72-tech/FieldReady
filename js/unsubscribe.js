// The page an offer email's "Stop offer emails" link opens (unsubscribe.html#t=<the farm's token>).
// One tap stops the dealer's offer emails to that farm: the database's stop_offer_emails, which
// anyone holding the link may call, and which records it in the dealer's activity log. It asks
// first, so a mail scanner that opens the link changes nothing. No sign-in, and the page shows
// nothing about the farm beyond the dealer's name.

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";
import { escape } from "./ui.js";
import { unsubscribeToken } from "./promotions-model.js";

const root = document.getElementById("app");
const token = unsubscribeToken(location.hash);

function page(title, body) {
  root.innerHTML = `
    <main class="signin">
      <div class="signin-card">
        <div class="hero">
          <p class="eyebrow">Field Ready</p>
          <h1>${escape(title)}</h1>
        </div>
        ${body}
      </div>
    </main>`;
}

function renderStart(message = "") {
  if (!token) {
    page("Stop offer emails", `
      <div class="card">
        <p>This page needs the link from an offer email. Open the email and tap <strong>Stop offer emails</strong> again.</p>
      </div>`);
    return;
  }
  page("Stop offer emails", `
    <div class="card">
      <p>Stop getting offers from your dealer by email?</p>
      ${message ? `<p class="form-error">${escape(message)}</p>` : ""}
      <div class="actions"><button class="primary" data-action="stop">Stop Offer Emails</button></div>
      <p class="hint">If you use the Field Ready app, offers still show there until you turn them off in its Settings (Show offers).</p>
    </div>`);
}

async function stop(button) {
  button.disabled = true;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/stop_offer_emails`, {
      method: "POST",
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const rows = await response.json();
    const dealer = Array.isArray(rows) ? rows[0]?.dealer : null;
    if (!dealer) {
      page("Link not recognized", `
        <div class="card">
          <p>This link doesn't match a customer any more. If offer emails keep coming, reply to one and ask to stop.</p>
        </div>`);
      return;
    }
    page("You're unsubscribed", `
      <div class="card">
        <p>${escape(dealer)} won't email you offers any more.</p>
        <p class="hint">Changed your mind? Ask ${escape(dealer)} to turn offer emails back on.</p>
      </div>`);
  } catch {
    renderStart("Couldn't reach Field Ready. Check your connection and try again.");
  }
}

root.addEventListener("click", (event) => {
  const button = event.target.closest('[data-action="stop"]');
  if (button) stop(button);
});

if (!globalThis.fieldReadyFramed) renderStart();
