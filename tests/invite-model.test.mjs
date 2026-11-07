// Tests for js/invite-model.js. Run with the JavaScript engine built into macOS (no installs):
//
//   JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
//   $JSC -m tests/invite-model.test.mjs

import * as inviteModel from "../js/invite-model.js";
const { linkToken, linkProblem, inviteResult, inviteNotice } = inviteModel;

let passed = 0;
const failures = [];
function check(name, condition) {
  if (condition) passed += 1;
  else failures.push(name);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Reading the link
check("a welcome link's token and type", same(linkToken("#token_hash=abc123&type=recovery"), { token: "abc123", type: "recovery" }));
check("…without the #", same(linkToken("token_hash=abc123&type=invite"), { token: "abc123", type: "invite" }));
check("the type defaults to recovery", same(linkToken("#token_hash=abc"), { token: "abc", type: "recovery" }));
check("encoded tokens are decoded", linkToken("#token_hash=a%2Bb%3D&type=recovery").token === "a+b=");
check("no token, no link", linkToken("#type=recovery") === null && linkToken("") === null && linkToken(null) === null);
check("a blank token isn't a link", linkToken("#token_hash=%20&type=recovery") === null);
check("unknown types are refused", linkToken("#token_hash=abc&type=signup") === null);
check("broken encoding is refused", linkToken("#token_hash=%E0%A4%A") === null);

// Opening the app
check("the page never hands the token to a fieldready:// link", !("appLink" in inviteModel));
check("a token with + and = reads back the same", same(linkToken("#token_hash=a%2Bb%3D&type=recovery"), { token: "a+b=", type: "recovery" }));

// Problems in plain words
check("expired links", linkProblem({ message: "Email link is invalid or has expired", status: 403 }).startsWith("This link has expired or was already used."));
check("used links", linkProblem({ code: "otp_expired" }).includes("already used"));
check("no connection", linkProblem(new TypeError("Failed to fetch")).startsWith("Can't reach Field Ready"));

// After Send Invite
{
  const who = { kind: "new", name: "Pat", email: "pat@example.com" };
  const sent = inviteResult({ status: "created", emailed: true }, who);
  check("sent: no link to show", sent.emailed && sent.link === null && sent.problem === null);
  check("sent notice", inviteNotice(sent) === "Invitation sent to pat@example.com.");
  const notSent = inviteResult({ status: "created", emailed: false, emailProblem: "Email isn't set up yet.", link: "https://x/welcome.html#token_hash=t" }, who);
  check("not sent: the reason and the link", !notSent.emailed && notSent.problem === "Email isn't set up yet." && notSent.link.endsWith("#token_hash=t"));
  check("not sent notice", inviteNotice(notSent) === "Added Pat, but couldn't email them.");
  check("an answer with nothing still reads", inviteResult({}, who).problem === "The email wasn't sent." && inviteResult({}, who).link === null);
  const reset = inviteResult({ status: "sent", emailed: true }, { ...who, kind: "reset" });
  check("reset notice", inviteNotice(reset) === "Emailed Pat a link to choose a new password.");
}

print(`${passed} passed, ${failures.length} failed`);
for (const name of failures) print(`FAIL ${name}`);
if (failures.length) throw new Error(`${failures.length} failed`);
