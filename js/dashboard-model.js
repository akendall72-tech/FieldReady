// Wording and arithmetic for the Dashboard page (views/dashboard.js), kept apart so it can be tested.
// An inspection's result comes from the database (inspection_details in
// migrations/20261119100000_dashboards.sql), which follows the app's ReadinessEvaluator. Subscription
// states follow the app's SubscriptionStatus (expired; 0–30 days; 31–90 days; later; no date), as
// the database's dashboard_summary counts them. Change them together.

import { machineName } from "./equipment-model.js";

export { machineName };

// ---------------------------------------------------------------- days

const pad = (n) => String(n).padStart(2, "0");

/** A date as the person's own calendar day, YYYY-MM-DD. */
export function localDay(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const dayNumber = (day) => {
  const [y, m, d] = String(day).slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

/** Whole days from one YYYY-MM-DD to another (negative when `to` is earlier). */
export const daysBetween = (from, to) => Math.round(dayNumber(to) - dayNumber(from));

/** A YYYY-MM-DD this many days after another. */
export function addDays(day, days) {
  const d = new Date((dayNumber(day) + days) * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** A day in words, like "Mar 4, 2026". */
export function dayWords(day) {
  if (!day) return "";
  const [y, m, d] = String(day).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** How long ago a day was, in plain words: Today, Yesterday, 5 days ago, 3 weeks ago, 8 months ago, 2 years ago. */
export function agoWords(day, today) {
  const days = daysBetween(day, today);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} months ago`;
  return `${Math.floor(days / 365.25)} years ago`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- inspection results

/** The four results, as the app shows them (StatusStyle: colors and symbols). */
export const RESULTS = {
  ready: { label: "Ready", tone: "ready", icon: "check" },
  readyWithRecommendations: { label: "Ready With Recommendations", tone: "recommend", icon: "note" },
  notReady: { label: "Not Ready", tone: "fail", icon: "cross" },
  incomplete: { label: "Incomplete", tone: "incomplete", icon: "dash" },
};

export const resultFor = (key) => RESULTS[key] ?? { label: "Result not available", tone: "incomplete", icon: "dash" };

/** What an inspection found, in a line: "1 failed check · 2 recommendations", or "Every check passed". */
export function findingsWords(details) {
  if (!details) return "";
  const parts = [];
  if (details.failed) parts.push(plural(details.failed, "failed check"));
  if (details.recommended) parts.push(plural(details.recommended, "recommendation"));
  if (details.outstanding) parts.push(`${plural(details.outstanding, "required check")} not done`);
  return parts.length ? parts.join(" · ") : "Every check passed";
}

/** A failed or recommended check, labeled as the report does. */
export const ISSUE_RESULTS = {
  fail: { label: "Failed", tone: "fail", icon: "cross" },
  needsDiagnosis: { label: "Recommendation", tone: "recommend", icon: "note" },
};

const SEVERITIES = { critical: "Critical", major: "Major", minor: "Minor", advisory: "Advisory" };
export const severityLabel = (severity) => SEVERITIES[severity] ?? "";

/** Who did an inspection, for the person reading the dashboard. */
export function whoDid(row, viewerRole) {
  const name = String(row.technician_name ?? "").trim();
  if (viewerRole === "customer") return row.done_by_customer ? `Done by ${name || "your farm"}` : `Done by ${name || "your dealer"}`;
  return row.done_by_customer ? `Done by ${name || "the customer"} (customer)` : `Done by ${name || "a technician"}`;
}

/** The checklist an inspection used: its title, else its kind. */
export function checklistWords(row, details) {
  if (details?.checklist_title) return details.checklist_title;
  return { guidance: "Guidance inspection", planter: "Planter inspection", machine: "Machine inspection", custom: "Custom checklist" }[row.kind] ?? "Inspection";
}

/** A name to save a report under, like "Fendt 724 Vario 2026-03-04 report.pdf". */
export function reportFileName(row) {
  const day = row.finalized_at ? localDay(row.finalized_at) : "";
  const name = `${machineName(row)} ${day} report`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `${name || "Field Ready report"}.pdf`;
}

// ---------------------------------------------------------------- subscriptions

/** A subscription's state on a day: key, days left (negative once expired), and the app's words for it. */
export function subscriptionState(expiration, today) {
  if (!expiration) return { key: "noDate", days: null, label: "No expiration date", tone: "none" };
  const days = daysBetween(today, expiration);
  if (days < 0) return { key: "expired", days, label: "Expired", tone: "fail" };
  const label = days === 0 ? "Expires today" : `Expires in ${plural(days, "day")}`;
  if (days <= 30) return { key: "soon", days, label, tone: "urgent" };
  if (days <= 90) return { key: "expiring", days, label, tone: "warning" };
  return { key: "current", days, label: "Current", tone: "ready" };
}

/** When it expired or expires, in words: "Expired Oct 2, 2026 (40 days ago)", "Renews by Dec 1, 2026". */
export function subscriptionDateWords(expiration, today) {
  if (!expiration) return "No expiration date on record";
  const days = daysBetween(today, expiration);
  if (days < 0) return `Expired ${dayWords(expiration)} (${agoWords(expiration, today).toLowerCase()})`;
  return `Expires ${dayWords(expiration)}`;
}

/** The tracker's parts, in order (the dashboard_summary columns they come from). */
export const SUBSCRIPTION_PARTS = [
  { key: "expired", label: "Expired", tone: "fail", column: "subscriptions_expired" },
  { key: "soon", label: "Within 30 days", tone: "urgent", column: "subscriptions_30" },
  { key: "expiring", label: "31–90 days", tone: "warning", column: "subscriptions_90" },
  { key: "current", label: "Current", tone: "ready", column: "subscriptions_current" },
  { key: "noDate", label: "No date", tone: "none", column: "subscriptions_no_date" },
];

/** The tracker's parts with their counts and shares of every subscription (0–100). */
export function subscriptionParts(summary) {
  const parts = SUBSCRIPTION_PARTS.map((part) => ({ ...part, count: Number(summary?.[part.column] ?? 0) }));
  const total = parts.reduce((sum, part) => sum + part.count, 0);
  return { total, parts: parts.map((part) => ({ ...part, share: total ? (part.count / total) * 100 : 0 })) };
}

/** Subscriptions to renew: expired or expiring within 90 days (the app's needsAttention). */
export const toRenew = (summary) => Number(summary?.subscriptions_expired ?? 0) + Number(summary?.subscriptions_30 ?? 0) + Number(summary?.subscriptions_90 ?? 0);

/** A share as a whole percent, never 0% for a part that has some (and never 100% for one that isn't all). */
export function shareWords(count, total) {
  if (!total || !count) return "0%";
  const percent = Math.round((count / total) * 100);
  if (percent === 0) return "<1%";
  if (percent === 100 && count < total) return ">99%";
  return `${percent}%`;
}

// ---------------------------------------------------------------- the numbers

/** The tiles across the top: label, value, and a line saying what it counts. */
export function tiles(summary, role) {
  const s = summary ?? {};
  const n = (column) => Number(s[column] ?? 0);
  const renew = toRenew(s);
  if (role === "customer") {
    return [
      { key: "machines", label: "Machines", value: n("machines"), caption: "On your farm", tone: "neutral" },
      { key: "due", label: "Due for inspection", value: n("not_inspected_year"), caption: "Not inspected in the last 12 months", tone: n("not_inspected_year") ? "warning" : "ready" },
      { key: "notReady", label: "Not ready", value: n("not_ready"), caption: "Newest inspection failed a check", tone: n("not_ready") ? "fail" : "ready" },
      { key: "renew", label: "Subscriptions to renew", value: renew, caption: "Expired or due within 90 days", tone: renew ? "urgent" : "ready" },
    ];
  }
  return [
    { key: "recent", label: "Inspections", value: n("inspections_30"), caption: `Finished in the last 30 days · ${n("customer_inspections_30")} by customers`, tone: "neutral" },
    { key: "notReady", label: "Not ready", value: n("not_ready"), caption: "Machines whose newest inspection failed a check", tone: n("not_ready") ? "fail" : "ready" },
    { key: "due", label: "Due for inspection", value: n("not_inspected_year"), caption: `Of ${plural(n("machines"), "active machine")}, not inspected in 12 months`, tone: n("not_inspected_year") ? "warning" : "ready" },
    { key: "renew", label: "Subscriptions to renew", value: renew, caption: "Expired or due within 90 days", tone: renew ? "urgent" : "ready" },
  ];
}

/** A count in short form: 1,284 / 12.9K. */
export function countWords(value) {
  const n = Number(value ?? 0);
  if (n < 10000) return n.toLocaleString("en-US");
  if (n < 1000000) return `${(n / 1000).toFixed(n < 100000 ? 1 : 0).replace(/\.0$/, "")}K`;
  return `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
}

// ---------------------------------------------------------------- machine timelines (customers)

/** How many years a machine's timeline shows, ending today. */
export const TIMELINE_YEARS = 3;

/** Where a day sits on a timeline from `start` to `end` (0–100, clamped). */
export function position(day, start, end) {
  const span = daysBetween(start, end);
  if (span <= 0) return 100;
  return Math.min(100, Math.max(0, (daysBetween(start, day) / span) * 100));
}

/** The year marks on a timeline: January 1 of each year after its start. */
export function timelineTicks(start, end) {
  const ticks = [];
  for (let year = Number(start.slice(0, 4)) + 1; year <= Number(end.slice(0, 4)); year += 1) {
    const day = `${year}-01-01`;
    ticks.push({ label: String(year), left: position(day, start, end) });
  }
  return ticks;
}

/**
 * Each active machine with its finished inspections (newest first), its newest result, whether it's
 * due (no inspection in the last 365 days), and the points on its timeline. Machines needing
 * attention come first: not ready, then due, then the rest, each by name.
 */
export function machineTimelines(machines, inspections, details, today, years = TIMELINE_YEARS) {
  const start = addDays(today, -Math.round(years * 365.25));
  const byMachine = new Map();
  for (const row of inspections) {
    if (!byMachine.has(row.machine_id)) byMachine.set(row.machine_id, []);
    byMachine.get(row.machine_id).push(row);
  }
  const rows = machines.filter((machine) => !machine.archived_at).map((machine) => {
    const list = (byMachine.get(machine.id) ?? []).slice()
      .sort((a, b) => String(b.finalized_at).localeCompare(String(a.finalized_at)) || String(a.id).localeCompare(String(b.id)));
    const last = list[0] ?? null;
    const lastDay = last ? localDay(last.finalized_at) : null;
    const lastResult = last ? details.get(last.id)?.result ?? null : null;
    const due = !lastDay || daysBetween(lastDay, today) > 365;
    const points = list
      .map((row) => ({ id: row.id, day: localDay(row.finalized_at), result: details.get(row.id)?.result ?? null }))
      .filter((point) => point.day >= start)
      .map((point) => ({ ...point, left: position(point.day, start, today) }))
      .reverse();
    return { machine, inspections: list, last, lastDay, lastResult, due, points, earlier: list.length - points.length };
  });
  const rank = (row) => (row.lastResult === "notReady" ? 0 : row.due ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || machineName(a.machine).localeCompare(machineName(b.machine)) || String(a.machine.id).localeCompare(String(b.machine.id)));
  return { start, end: today, ticks: timelineTicks(start, today), rows };
}

/** A machine's last inspection in words: "Last inspected Mar 4, 2026 · 8 months ago", or "Never inspected". */
export function lastInspectedWords(row, today) {
  if (!row.lastDay) return "Never inspected";
  return `Last inspected ${dayWords(row.lastDay)} · ${agoWords(row.lastDay, today)}`;
}
