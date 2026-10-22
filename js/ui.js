// Small helpers for building pages from text. Every value placed in a page goes through escape(),
// so names and checklist text can't inject markup.

export function escape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** `selected`/`checked`/`disabled` attributes from booleans. */
export const attr = (name, on) => (on ? ` ${name}` : "");

export function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** A short message at the top of the page. Kind: "info", "success", or "error". */
export function notice(root, message, kind = "info") {
  const area = root.querySelector("[data-notice]");
  if (!area) return;
  area.innerHTML = message ? `<div class="notice notice-${kind}" role="status">${escape(message)}</div>` : "";
}
