// Tests for js/checklist-model.js. Run with the JavaScript engine built into macOS (no installs):
//
//   JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
//   $JSC -m tests/checklist-model.test.mjs -- ../FieldReady/FieldReady/Resources/Templates/*.json ../FieldReady/supabase/seed/default_catalog.sql
//
// The optional arguments are the app's bundled checklists, which must pass the same rules, and its
// default option seed, which supplies the option values phones know.

import {
  problems, isNewer, nextVersion, liveVersion, slug, uniqueKey, newCheck, newSection, draftFrom, move, itemKeys,
  kindOf, typesOf, newChecklist, copyChecklist, guidanceForms, machineFormFor, formId, guidanceFormFrom, machineFormFrom,
  FACTORY, OTHER_SYSTEM,
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
// Kinds and equipment types
check("older checklists read as Guidance or Planter", kindOf({}) === "guidance" && kindOf({ equipment: "planter" }) === "planter"
  && kindOf({ kind: "machine", equipment: ["planter"] }) === "machine");
check("one equipment type or several", typesOf({ equipment: "planter" }).join() === "planter" && typesOf({ equipment: ["baler", "rake"] }).join() === "baler,rake"
  && typesOf({}).length === 0);
const fresh = newChecklist({ kind: "machine", title: "Combine preseason", equipment: ["combine"], taken: new Set(["machine-combinePreseason"]) });
check("a new checklist gets its own id, version 1, and one check to start", fresh.id === "machine-combinePreseason2" && fresh.version === "1"
  && fresh.kind === "machine" && fresh.equipment.join() === "combine" && fresh.sections[0].items.length === 1);
check("…which needs its steps filled in before publishing", problems(fresh).some((p) => p.includes("How to Check step")));
const mine = newChecklist({ kind: "custom", title: "Hitch check", suffix: "a1b2" });
check("custom checklists carry a suffix and any type", mine.id === "custom-hitchCheckA1b2" && mine.equipment === undefined);
const copied = copyChecklist({ ...fresh, version: "3" }, { title: "Combine harvest", taken: new Set() });
check("a copy keeps the checks under a new id at version 1", copied.id === "machine-combineHarvest" && copied.version === "1"
  && copied.sections[0].items.length === 1 && fresh.version === "1");
check("unknown kinds are caught", problems({ ...fresh, kind: "drone" }).includes("The checklist's kind isn't one phones know."));
check("unknown equipment types are caught", problems(fresh, { equipment_type: new Set(["tractor"]) })
  .includes("The checklist is for an equipment type phones don't know yet."));
const branching = JSON.parse(JSON.stringify(fresh));
branching.sections[0].items[0].steps = ["Look"];
branching.sections[0].items[0].appliesTo = { answers: { undercarriage: ["tracks"] }, equipment: ["combine"] };
check("checks can branch on answers and types", problems(branching).length === 0);
branching.sections[0].items[0].appliesTo = { answers: { undercarriage: "tracks" } };
check("…in the shape phones read", problems(branching).some((p) => p.includes("answers setting")));

// Guidance forms: one per system
{
  const systems = [
    { value: "ptx", label: "PTx", active: true, details: { factoryIntegrated: false } },
    { value: "fendtGuide", label: "Fendt Guide", active: true, details: { factoryIntegrated: true } },
    { value: "mfGuide", label: "MF Guide", active: true, details: { factoryIntegrated: true } },
    { value: "other", label: "Other", active: true, details: { factoryIntegrated: false } },
    { value: "johnDeere", label: "John Deere", active: true, details: { factoryIntegrated: false } },
    { value: "trimble", label: "Trimble", active: true, details: { factoryIntegrated: false } },
    { value: "oldBrand", label: "Old brand", active: false, details: { factoryIntegrated: false } },
  ];
  const form = (system, extra = {}) => ({ id: `guidance-${system}`, content: { ...minimal(), id: `guidance-${system}`, kind: "guidance", system, title: `${system} form` }, retired: false, ...extra });
  const shared = { id: "preseason-general", content: minimal(), retired: false };
  const forms = [form("factory"), form("ptx"), form("johnDeere"), form("other"), shared];
  const entries = guidanceForms(systems, forms);
  check("the dropdown: Factory, each other system, then Other", same(entries.map((e) => e.key), ["factory", "ptx", "johnDeere", "trimble", "other"]));
  check("Factory Guidance names the systems it covers", same(entries[0].covers, ["Fendt Guide", "MF Guide"]) && entries[0].form.id === "guidance-factory");
  check("a system without its own form has none (it uses Other)", entries.find((e) => e.key === "trimble").form === null);
  check("hidden systems without a form are left out", !entries.some((e) => e.key === "oldBrand"));
  check("a retired form doesn't count", guidanceForms(systems, [form("factory"), form("ptx", { retired: true }), form("other")]).find((e) => e.key === "ptx").form === null);
  check("a form for a system no longer listed still shows", guidanceForms(systems, [...forms, form("gone")]).some((e) => e.key === "gone"));
  check("before any forms, the shared checklist is the only entry", same(guidanceForms(systems, [shared]).map((e) => e.key), ["shared"]));
  check("…and with neither, nothing", guidanceForms(systems, []).length === 0);

  const trimble = guidanceFormFrom(form("other").content, { system: "trimble", title: "Trimble guidance inspection", taken: new Set(["guidance-other"]) });
  check("a system's own form copies another with its own id and system", trimble.id === "guidance-trimble" && trimble.system === "trimble"
    && trimble.version === "1" && trimble.kind === "guidance" && trimble.title === "Trimble guidance inspection" && problems(trimble).length === 0);
  check("only Guidance forms name a system", problems({ ...trimble, kind: "machine" }).includes("Only Guidance forms are for a guidance system."));
  check("…and the system can't be blank", problems({ ...trimble, system: " " }).includes("The Guidance form doesn't say which guidance system it's for."));
  check("form ids come from what they're for", formId("machine", "combine") === "machine-combine" && formId("machine", "combine", new Set(["machine-combine"])) === "machine-combine2");
  check("the shared ids are FACTORY and OTHER_SYSTEM", FACTORY === "factory" && OTHER_SYSTEM === "other");
}

// Machine forms: one per type
{
  const machine = (id, equipment, extra = {}) => ({ id, content: { ...minimal(), id, kind: "machine", equipment }, retired: false, ...extra });
  const forms = [machine("machine-baleRake", ["baler", "rake"]), machine("machine-baler", ["baler"]), machine("machine-old", ["combine"], { retired: true })];
  check("a type's own form comes first", machineFormFor("baler", forms).id === "machine-baler");
  check("…else an older form that covers it among others", machineFormFor("rake", forms).id === "machine-baleRake");
  check("retired forms don't count", machineFormFor("combine", forms) === null);
  check("a form for every type covers the rest", machineFormFor("combine", [...forms, machine("machine-any", undefined)]).id === "machine-any");
  const combine = machineFormFrom(null, { type: "combine", title: "Combine machine inspection", taken: new Set() });
  check("a new Machine form is for one type, with one check to start", combine.id === "machine-combine" && same(combine.equipment, ["combine"])
    && combine.kind === "machine" && combine.sections[0].items.length === 1);
  const fromBaler = machineFormFrom(forms[1].content, { type: "windrower", title: "Windrower machine inspection", taken: new Set() });
  check("…or a copy of another type's form", fromBaler.id === "machine-windrower" && same(fromBaler.equipment, ["windrower"]) && fromBaler.version === "1"
    && fromBaler.sections[0].items.length === minimal().sections[0].items.length);
}

let known = {
  guidance_system: new Set(["ptx", "fendtGuide", "mfGuide", "other"]),
  feature: new Set(["implementGuidance", "automaticTurns", "sectionControl", "isobus", "rateControl", "dataTransfer"]),
  correction_type: new Set(["standardGNSS", "satellite", "networkRTK", "localRTK", "other", "unknown"]),
};
if (seedPath) {
  known = {};
  // Option rows: (list, value, label, parent, order, details); the Guidance forms' (system, title) pairs don't count.
  for (const [, list, value] of read(seedPath).matchAll(/^\s*\('([a-z_]+)', '((?:[^']|'')*)', '(?:[^']|'')*', (?:null|'[^']*'), \d+, /gm)) {
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
