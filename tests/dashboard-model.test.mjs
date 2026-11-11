// Tests for js/dashboard-model.js. Run with the JavaScript engine built into macOS (no installs):
//
//   JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
//   $JSC -m tests/dashboard-model.test.mjs

import {
  localDay, daysBetween, addDays, agoWords, RESULTS, resultFor, findingsWords, ISSUE_RESULTS, severityLabel, whoDid, checklistWords,
  reportFileName, subscriptionState, subscriptionDateWords, SUBSCRIPTION_PARTS, subscriptionParts, toRenew, shareWords, tiles,
  countWords, position, timelineTicks, machineTimelines, lastInspectedWords,
} from "../js/dashboard-model.js";

let passed = 0;
const failures = [];
function check(name, condition) {
  if (condition) passed += 1;
  else failures.push(name);
}

const today = "2026-11-19";

// Days
check("a local day", localDay(new Date(2026, 2, 4, 23, 30)) === "2026-03-04");
check("days between", daysBetween("2026-11-19", "2026-12-19") === 30 && daysBetween("2026-11-19", "2026-11-14") === -5);
check("…across a daylight saving change", daysBetween("2026-03-07", "2026-03-09") === 2 && daysBetween("2026-10-31", "2026-11-02") === 2);
check("…across a leap day", daysBetween("2028-02-28", "2028-03-01") === 2);
check("adding days", addDays(today, 90) === "2027-02-17" && addDays(today, -19) === "2026-10-31");
check("how long ago", agoWords(today, today) === "Today" && agoWords("2026-11-18", today) === "Yesterday"
  && agoWords("2026-11-14", today) === "5 days ago" && agoWords("2026-10-29", today) === "3 weeks ago"
  && agoWords("2026-03-19", today) === "8 months ago" && agoWords("2024-06-01", today) === "2 years ago");
check("a day in the future reads as today", agoWords("2026-11-20", today) === "Today");

// Results
check("the app's four results", Object.keys(RESULTS).join() === "ready,readyWithRecommendations,notReady,incomplete");
check("…as the app names them", RESULTS.ready.label === "Ready" && RESULTS.readyWithRecommendations.label === "Ready With Recommendations"
  && RESULTS.notReady.label === "Not Ready" && RESULTS.incomplete.label === "Incomplete");
check("…each with its own icon, so color isn't the only signal", new Set(Object.values(RESULTS).map((r) => r.icon)).size === 4);
check("an unknown result still has words", resultFor(undefined).label === "Result not available");
check("findings in a line", findingsWords({ failed: 1, recommended: 2, outstanding: 0 }) === "1 failed check · 2 recommendations"
  && findingsWords({ failed: 0, recommended: 0, outstanding: 3 }) === "3 required checks not done");
check("…or that everything passed", findingsWords({ failed: 0, recommended: 0, outstanding: 0 }) === "Every check passed");
check("…nothing before the details arrive", findingsWords(undefined) === "");
check("failed and recommended checks as the report labels them", ISSUE_RESULTS.fail.label === "Failed" && ISSUE_RESULTS.needsDiagnosis.label === "Recommendation");
check("severity", severityLabel("major") === "Major" && severityLabel(null) === "");
check("who did it, for staff", whoDid({ technician_name: "Erin Tech" }, "admin") === "Done by Erin Tech"
  && whoDid({ technician_name: "Hank Hill", done_by_customer: true }, "owner") === "Done by Hank Hill (customer)");
check("…for the customer", whoDid({ technician_name: "Erin Tech" }, "customer") === "Done by Erin Tech"
  && whoDid({ technician_name: "", done_by_customer: true }, "customer") === "Done by your farm");
check("the checklist's title, else its kind", checklistWords({ kind: "planter" }, { checklist_title: "Planter check" }) === "Planter check"
  && checklistWords({ kind: "planter" }, null) === "Planter inspection" && checklistWords({ kind: "odd" }, null) === "Inspection");
check("a report's file name", reportFileName({ manufacturer: "Fendt", model_name: "724/Vario", finalized_at: "2026-03-04T15:00:00" }) === "Fendt 724 Vario 2026-03-04 report.pdf");

// Subscriptions (the app's SubscriptionStatus)
const state = (day) => subscriptionState(day, today);
check("expired", state("2026-11-18").key === "expired" && state("2026-11-18").label === "Expired" && state("2026-11-18").days === -1);
check("expires today", state(today).key === "soon" && state(today).label === "Expires today");
check("within 30 days", state("2026-12-19").key === "soon" && state("2026-12-19").label === "Expires in 30 days");
check("31 to 90 days", state("2026-12-20").key === "expiring" && state("2027-02-17").key === "expiring" && state("2027-02-17").label === "Expires in 90 days");
check("later is current", state("2027-02-18").key === "current" && state("2027-02-18").label === "Current");
check("one day", state("2026-11-20").label === "Expires in 1 day");
check("no date", state(null).key === "noDate" && state(null).label === "No expiration date");
check("expiration in words", subscriptionDateWords("2026-11-14", today).startsWith("Expired ") && subscriptionDateWords("2026-11-14", today).endsWith("(5 days ago)")
  && subscriptionDateWords("2027-01-01", today).startsWith("Expires ") && subscriptionDateWords(null, today) === "No expiration date on record");
check("the tracker's parts follow the server's columns", SUBSCRIPTION_PARTS.map((p) => p.column).join() ===
  "subscriptions_expired,subscriptions_30,subscriptions_90,subscriptions_current,subscriptions_no_date");
check("…and the states' keys", SUBSCRIPTION_PARTS.map((p) => p.key).join() === "expired,soon,expiring,current,noDate");
const summary = { subscriptions_expired: 1, subscriptions_30: 2, subscriptions_90: 1, subscriptions_current: 4, subscriptions_no_date: 0 };
const parts = subscriptionParts(summary);
check("parts add up", parts.total === 8 && parts.parts[3].share === 50 && parts.parts[4].share === 0);
check("no subscriptions: no shares", subscriptionParts({}).total === 0 && subscriptionParts(null).parts.every((p) => p.share === 0));
check("to renew is expired or due within 90 days", toRenew(summary) === 4 && toRenew(null) === 0);
check("shares in words", shareWords(1, 3) === "33%" && shareWords(1, 500) === "<1%" && shareWords(999, 1000) === ">99%" && shareWords(0, 5) === "0%" && shareWords(5, 5) === "100%");

// Tiles
const numbers = { machines: 12, not_inspected_year: 3, not_ready: 1, inspections_30: 9, customer_inspections_30: 2, ...summary };
const customerTiles = tiles(numbers, "customer");
check("a customer's tiles", customerTiles.map((t) => t.key).join() === "machines,due,notReady,renew" && customerTiles[3].value === 4);
check("staff tiles", tiles(numbers, "admin").map((t) => t.key).join() === "recent,notReady,due,renew" && tiles(numbers, "owner")[0].value === 9);
check("…with how many customers did", tiles(numbers, "admin")[0].caption === "Finished in the last 30 days · 2 by customers");
check("…and how many machines the due count is out of", tiles(numbers, "admin")[2].caption === "Of 12 active machines, not inspected in 12 months");
check("…a tile needing attention says so, an all-clear one doesn't", tiles(numbers, "admin")[1].tone === "fail" && tiles({ ...numbers, not_ready: 0 }, "admin")[1].tone === "ready");
check("tiles before the numbers arrive", tiles(null, "customer").every((t) => t.value === 0));
check("counts in short form", countWords(1284) === "1,284" && countWords(12900) === "12.9K" && countWords(120000) === "120K" && countWords(4200000) === "4.2M" && countWords(undefined) === "0");

// Timelines
check("a position on a timeline", position("2026-01-01", "2025-01-01", "2027-01-01") > 49 && position("2026-01-01", "2025-01-01", "2027-01-01") < 51
  && position("2020-01-01", "2025-01-01", "2027-01-01") === 0 && position("2030-01-01", "2025-01-01", "2027-01-01") === 100);
check("year marks", timelineTicks("2023-11-19", today).map((t) => t.label).join() === "2024,2025,2026");
const machines = [
  { id: "m-a", manufacturer: "Fendt", model_name: "724", archived_at: null },
  { id: "m-b", manufacturer: "Kinze", model_name: "3660", archived_at: null },
  { id: "m-c", manufacturer: "Apex", model_name: "1", archived_at: null },
  { id: "m-old", manufacturer: "Ford", model_name: "8N", archived_at: "2026-01-01T00:00:00Z" },
];
const inspections = [
  { id: "i-1", machine_id: "m-a", finalized_at: "2026-10-01T15:00:00" },
  { id: "i-2", machine_id: "m-a", finalized_at: "2025-10-01T15:00:00" },
  { id: "i-3", machine_id: "m-a", finalized_at: "2021-10-01T15:00:00" },
  { id: "i-4", machine_id: "m-b", finalized_at: "2025-06-01T15:00:00" },
];
const details = new Map([["i-1", { result: "notReady" }], ["i-2", { result: "ready" }], ["i-3", { result: "ready" }], ["i-4", { result: "readyWithRecommendations" }]]);
const lines = machineTimelines(machines, inspections, details, today);
check("archived machines are left out", lines.rows.length === 3 && !lines.rows.some((r) => r.machine.id === "m-old"));
check("not ready first, then due, then the rest by name", lines.rows.map((r) => r.machine.id).join() === "m-a,m-c,m-b");
const fendt = lines.rows[0];
check("a machine's newest inspection and result", fendt.last.id === "i-1" && fendt.lastResult === "notReady" && fendt.lastDay === "2026-10-01" && !fendt.due);
check("…its points in the window, oldest first, with older ones counted", fendt.points.map((p) => p.id).join() === "i-2,i-1" && fendt.earlier === 1
  && fendt.points[0].left < fendt.points[1].left && fendt.points[1].left <= 100);
check("over a year since: due", lines.rows.find((r) => r.machine.id === "m-b").due);
check("never inspected: due, with no points", lines.rows[1].due && lines.rows[1].points.length === 0 && lines.rows[1].last === null);
check("last inspected in words", lastInspectedWords(lines.rows[1], today) === "Never inspected" && lastInspectedWords(fendt, today).endsWith("· 7 weeks ago"));
check("the window is the last three years", lines.end === today && daysBetween(lines.start, today) === 1096);

print(`${passed} passed, ${failures.length} failed`);
for (const name of failures) print(`FAIL ${name}`);
if (failures.length) throw new Error(`${failures.length} failed`);
