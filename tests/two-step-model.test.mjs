// Tests for js/two-step-model.js. Run with the JavaScript engine built into macOS (no installs):
//
//   JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
//   $JSC -m tests/two-step-model.test.mjs

import { cleanCode, needsCode, verifiedFactor, unfinishedFactors } from "../js/two-step-model.js";

let passed = 0;
const failures = [];
function check(name, condition) {
  if (condition) passed += 1;
  else failures.push(name);
}

check("six digits", cleanCode("123456") === "123456");
check("spaces and dashes are ignored", cleanCode(" 123 456 ") === "123456" && cleanCode("123-456") === "123456");
check("too short or long", cleanCode("12345") === null && cleanCode("1234567") === null);
check("only digits", cleanCode("12a456") === null && cleanCode("١٢٣٤٥٦") === null && cleanCode(null) === null);

check("asks when on and unused", needsCode({ currentLevel: "aal1", nextLevel: "aal2" }));
check("not once used", !needsCode({ currentLevel: "aal2", nextLevel: "aal2" }));
check("not when off", !needsCode({ currentLevel: "aal1", nextLevel: "aal1" }) && !needsCode(null));

const factors = {
  all: [{ id: "a", status: "unverified" }, { id: "b", status: "verified" }],
  totp: [{ id: "b", status: "verified" }],
};
check("the verified authenticator", verifiedFactor(factors)?.id === "b");
check("none when off", verifiedFactor({ all: [{ id: "a", status: "unverified" }], totp: [] }) === null && verifiedFactor(undefined) === null);
check("unfinished set-ups", unfinishedFactors(factors).map((f) => f.id).join() === "a");

print(`${passed} passed, ${failures.length} failed`);
for (const name of failures) print(`FAIL ${name}`);
if (failures.length) throw new Error(`${failures.length} failed`);
