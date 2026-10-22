// Tests for js/checklist-model.js. Run with the JavaScript engine built into macOS (no installs):
//
//   JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
//   $JSC -m tests/checklist-model.test.mjs -- ../FieldReady/FieldReady/Resources/Templates/*.json ../FieldReady/supabase/seed/default_catalog.sql
//
// The optional arguments are the app's bundled checklists, which must pass the same rules, and its
// default option seed, which supplies the option values phones know.

import {
  problems, isNewer, nextVersion, liveVersion, slug, uniqueKey, newCheck, newSection, draftFrom, move, itemKeys,
} from "../js/checklist-model.js";

let passed = 0;
const failures = [];
function check(name, condition) {
  if (condition) passed += 1;
  else failures.push(name);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const minimal = () => ({
  id: "preseason-general",
  version: "0.7-draft",
  title: "Preseason",
  reviewStatus: "draft",
  sections: [{
    key: "identify",
    title: "Identify the system",
    summary: "",
    items: [{ key: "identify.display", title: "Display", purpose: "", steps: ["Look"], lookFor: "", condition: "keyOn", required: true }],
  }],
});

// problems()
check("a minimal checklist is usable", problems(minimal()).length === 0);
{
  const content = minimal();
  content.sections[0].items.push({ ...content.sections[0].items[0], title: "Copy" });
  check("repeated check keys are caught", problems(content).some((p) => p.includes("needs its own key")));
}
{
  const content = minimal();
  content.sections[0].items[0].title = "  ";
  check("blank titles are caught, naming the section as written", problems(content).includes("A check in “Identify the system” has no title."));
}
{
  const content = minimal();
  content.sections[0].items[0].condition = "sometimes";
  check("unknown conditions are caught", problems(content).some((p) => p.includes("machine condition")));
}
{
  const content = minimal();
  content.sections[0].items[0].evidence = "";
  check("an empty photo setting is caught (phones can't read it)", problems(content).some((p) => p.includes("photo setting")));
  content.sections[0].items[0].evidence = null;
  check("no photo setting is fine", problems(content).length === 0);
}
{
  const content = minimal();
  content.sections[0].items[0].appliesTo = { systems: ["ptx", "spaceship"] };
  const known = { guidance_system: new Set(["ptx", "fendtGuide", "mfGuide", "other"]) };
  check("unknown applies-to options are caught", problems(content, known).some((p) => p.includes("phones don't know")));
  content.sections[0].items[0].appliesTo = { systems: ["ptx"], requiresAutoSteer: true };
  check("known applies-to options are fine", problems(content, known).length === 0);
}
{
  const content = minimal();
  content.sections[0].items[0].record = [{ key: "model", label: "Model" }, { key: "model", label: "Again" }];
  check("repeated field keys are caught", problems(content).some((p) => p.includes("field without its own key")));
}
{
  const content = minimal();
  content.sections[0].items = [];
  check("a checklist with no checks is caught", problems(content).includes("The checklist has no checks."));
}

{
  const content = minimal();
  content.sections[0].items[0].steps = ["Look", " "];
  check("empty steps are caught (phones would show a blank step)", problems(content).some((p) => p.includes("empty How to Check step")));
  content.sections[0].items[0].steps = [];
  check("a check needs at least one step", problems(content).some((p) => p.includes("at least one How to Check step")));
}
{
  const content = minimal();
  const added = newCheck(content, content.sections[0], "Hydraulic filter");
  content.sections[0].items.push(added);
  check("a new check isn't publishable until its step is written", problems(content).some((p) => p.includes("“Hydraulic filter” has an empty")));
  added.steps = ["Check the filter indicator."];
  check("…and is once it is", problems(content).length === 0);
}

// Versions
check("0.8 is newer than 0.7-draft", isNewer("0.8", "0.7-draft"));
check("0.10 is newer than 0.9", isNewer("0.10", "0.9"));
check("0.7-draft is not newer than 0.7", !isNewer("0.7-draft", "0.7"));
check("non-numbers are never newer", !isNewer("draft", "0.1"));
check("next after 0.7-draft is 0.8", nextVersion("0.7-draft") === "0.8");
check("next after 1.9 is 1.10", nextVersion("1.9") === "1.10");
check("the live version is the highest published", liveVersion([
  { status: "published", version: "0.9" }, { status: "published", version: "0.10" }, { status: "draft", version: "0.11" },
]).version === "0.10");
check("no published version means none live", liveVersion([{ status: "draft", version: "1" }]) === null);

// Keys
check("slug makes camel case", slug("Display and software version") === "displayAndSoftwareVersion");
check("slug drops punctuation", slug("ISOBUS (implement) control!") === "isobusImplementControl");
check("unique keys get a number", uniqueKey("Antenna", new Set(["physical.antenna"]), "physical.") === "physical.antenna2");
{
  const content = minimal();
  const check1 = newCheck(content, content.sections[0], "Display");
  check("new checks get a key nothing else uses", check1.key === "identify.display2" && !itemKeys(content).has(check1.key));
  check1.steps = ["Look at it."];
  check("new checks are readable by phones once written", problems({ ...content, sections: [{ ...content.sections[0], items: [check1] }] }).length === 0);
  const section = newSection(content, "Identify the system");
  check("new sections get a key nothing else uses", section.key === "identifyTheSystem");
}

// Drafts and moving
{
  const live = minimal();
  const draft = draftFrom(live, "0.8");
  draft.sections[0].items[0].steps.push("More");
  check("a draft is a copy with the new version", draft.version === "0.8" && live.version === "0.7-draft" && live.sections[0].items[0].steps.length === 1);
}
{
  const array = ["a", "b", "c"];
  check("moving down returns the new index", move(array, 0, 1) === 1 && same(array, ["b", "a", "c"]));
  check("moving past the end does nothing", move(array, 2, 1) === 2 && same(array, ["b", "a", "c"]));
}

// The app's bundled checklists pass the same rules.
const args = typeof arguments !== "undefined" ? arguments : scriptArgs ?? [];
const seedPath = args.find((path) => path.endsWith(".sql"));
let known = {
  guidance_system: new Set(["ptx", "fendtGuide", "mfGuide", "other"]),
  feature: new Set(["implementGuidance", "automaticTurns", "sectionControl", "isobus", "rateControl", "dataTransfer"]),
  correction_type: new Set(["standardGNSS", "satellite", "networkRTK", "localRTK", "other", "unknown"]),
};
if (seedPath) {
  known = {};
  for (const [, list, value] of read(seedPath).matchAll(/^\s*\('([a-z_]+)', '((?:[^']|'')*)'/gm)) {
    (known[list] ??= new Set()).add(value.replaceAll("''", "'"));
  }
}
for (const templatePath of args.filter((path) => path.endsWith(".json"))) {
  const bundled = JSON.parse(read(templatePath));
  const found = problems(bundled, known);
  check(`${bundled.id} is usable (${found.join(" ")})`, found.length === 0);
}

print(`${passed} passed, ${failures.length} failed`);
for (const name of failures) print(`FAIL ${name}`);
if (failures.length) throw new Error(`${failures.length} failed`);
