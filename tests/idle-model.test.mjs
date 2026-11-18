// Tests for js/idle-model.js. Run with the JavaScript engine built into macOS (no installs):
//
//   JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
//   $JSC -m tests/idle-model.test.mjs

import { IDLE_HOURS, idleTooLong, IDLE_MESSAGE, lastUse } from "../js/idle-model.js";

let passed = 0;
const failures = [];
function check(name, condition) {
  if (condition) passed += 1;
  else failures.push(name);
}

const hour = 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 30, 12);
check("twelve hours", IDLE_HOURS === 12);
check("used an hour ago: still signed in", !idleTooLong(now - hour, now));
check("exactly twelve hours: still signed in", !idleTooLong(now - 12 * hour, now));
check("more than twelve hours: signed out", idleTooLong(now - 12 * hour - 1, now));
check("never recorded: not signed out (the first sign-in records it)", !idleTooLong(NaN, now) && !idleTooLong(0, now) && !idleTooLong(undefined, now));
check("a fresh sign-in counts as use", lastUse(now - 48 * hour, new Date(now - hour).toISOString()) === now - hour);
check("…and the later of the two wins", lastUse(now - hour, new Date(now - 48 * hour).toISOString()) === now - hour);
check("neither known", Number.isNaN(lastUse(NaN, undefined)));
check("the sign-in screen says why", IDLE_MESSAGE.startsWith("You were signed out after 12 hours"));

print(`${passed} passed, ${failures.length} failed`);
for (const name of failures) print(`FAIL ${name}`);
if (failures.length) throw new Error(`${failures.length} failed`);
