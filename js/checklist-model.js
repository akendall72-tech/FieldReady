// Checklist rules shared by the editor. Pure functions, no page code, so they're tested on their own
// (tests/checklist-model.test.mjs).
//
// A checklist is the JSON the Field Ready app reads (InspectionTemplate in the app). problems() applies
// the same rules the app applies before it uses a published checklist, plus the shape the app needs
// to read it at all, so nothing gets published that phones would skip.

export const CONDITIONS = [
  { value: "keyOff", label: "Key off" },
  { value: "keyOn", label: "Key on" },
  { value: "engineRunning", label: "Engine running, parked" },
  { value: "machineMoving", label: "Machine moving" },
];

export const EVIDENCE = [
  { value: "", label: "No photo needed" },
  { value: "photo", label: "Photo required" },
  { value: "photoOnFail", label: "Photo required if it fails" },
];

/** Machine-profile details a field to record can start from (ProfileField in the app). */
export const PROFILE_FIELDS = [
  { value: "", label: "Nothing (technician types it)" },
  { value: "display.model", label: "Display model" },
  { value: "display.serial", label: "Display serial number" },
  { value: "display.software", label: "Display software version" },
  { value: "receiver.model", label: "Receiver model" },
  { value: "receiver.serial", label: "Receiver serial number" },
  { value: "receiver.firmware", label: "Receiver firmware version" },
  { value: "steering.model", label: "Steering controller model" },
  { value: "steering.serial", label: "Steering controller serial number" },
  { value: "steering.firmware", label: "Steering controller firmware version" },
  { value: "correction.service", label: "Subscribed correction service" },
];

const CONDITION_VALUES = new Set(CONDITIONS.map((c) => c.value));
const EVIDENCE_VALUES = new Set(["photo", "photoOnFail"]);

const isText = (value) => typeof value === "string";
const isBlank = (value) => !isText(value) || value.trim() === "";
const isStringArray = (value) => Array.isArray(value) && value.every(isText);

/**
 * What would stop phones from using this checklist, in plain words. Empty when it's usable.
 * `known` lists the option values the app understands, by list name, so "applies to" can't name
 * something phones can't read.
 */
export function problems(content, known = {}) {
  const found = [];
  if (!content || typeof content !== "object") return ["The checklist is empty."];
  for (const field of ["id", "version", "title", "reviewStatus"]) {
    if (!isText(content[field])) found.push(`The checklist is missing its ${field}.`);
  }
  if (!Array.isArray(content.sections)) return [...found, "The checklist has no sections."];

  const sectionKeys = new Set();
  const itemKeys = new Set();
  for (const section of content.sections) {
    const sectionName = isBlank(section?.title) ? "A section" : `Section “${section.title}”`;
    const inSection = isBlank(section?.title) ? "a section" : `“${section.title}”`;
    if (isBlank(section?.key) || sectionKeys.has(section.key)) found.push(`${sectionName} needs its own key.`);
    else sectionKeys.add(section.key);
    if (isBlank(section?.title)) found.push("A section has no title.");
    if (!isText(section?.summary)) found.push(`${sectionName} is missing its summary.`);
    if (!Array.isArray(section?.items)) {
      found.push(`${sectionName} has no list of checks.`);
      continue;
    }
    for (const item of section.items) {
      const name = isBlank(item?.title) ? `A check in ${inSection}` : `Check “${item.title}”`;
      if (isBlank(item?.key) || itemKeys.has(item.key)) found.push(`${name} needs its own key.`);
      else itemKeys.add(item.key);
      if (isBlank(item?.title)) found.push(`A check in ${inSection} has no title.`);
      if (!isText(item?.purpose)) found.push(`${name} is missing “Why it matters”.`);
      if (!isStringArray(item?.steps)) found.push(`${name} has no How to Check steps.`);
      if (!isText(item?.lookFor)) found.push(`${name} is missing “What good looks like”.`);
      if (!CONDITION_VALUES.has(item?.condition)) found.push(`${name} needs a machine condition.`);
      if (typeof item?.required !== "boolean") found.push(`${name} must be required or optional.`);
      if (item?.evidence != null && !EVIDENCE_VALUES.has(item.evidence)) found.push(`${name} has an unknown photo setting.`);
      if (item?.safety != null && !isText(item.safety)) found.push(`${name} has an unreadable safety note.`);
      if (item?.panel != null && !isText(item.panel)) found.push(`${name} has an unreadable panel setting.`);

      const applies = item?.appliesTo;
      if (applies != null) {
        const lists = { systems: "guidance_system", features: "feature", corrections: "correction_type" };
        for (const [field, list] of Object.entries(lists)) {
          const values = applies[field];
          if (values == null) continue;
          if (!isStringArray(values)) found.push(`${name} has an unreadable “applies to” setting.`);
          else if (known[list] && values.some((v) => !known[list].has(v))) found.push(`${name} applies to an option phones don't know yet.`);
        }
        if (applies.requiresAutoSteer != null && typeof applies.requiresAutoSteer !== "boolean") {
          found.push(`${name} has an unreadable auto-steer setting.`);
        }
      }

      if (item?.record != null) {
        if (!Array.isArray(item.record)) {
          found.push(`${name} has an unreadable list of fields.`);
        } else {
          const fieldKeys = new Set();
          for (const field of item.record) {
            if (isBlank(field?.key) || isBlank(field?.label) || fieldKeys.has(field.key)) {
              found.push(`${name} has a field without its own key and label.`);
            } else {
              fieldKeys.add(field.key);
            }
          }
        }
      }
    }
  }
  if (itemKeys.size === 0) found.push("The checklist has no checks.");
  return found;
}

/** The numbers in a version like "0.7-draft" → [0, 7]; null when it isn't numeric. */
function versionNumbers(version) {
  if (!isText(version)) return null;
  const parts = version.split("-")[0].split(".");
  const numbers = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : NaN));
  return numbers.some(Number.isNaN) ? null : numbers;
}

/** True when `version` is later than `other` ("0.10" after "0.9"), as the app decides. */
export function isNewer(version, other) {
  const mine = versionNumbers(version);
  const theirs = versionNumbers(other);
  if (!mine || !theirs) return false;
  for (let index = 0; index < Math.max(mine.length, theirs.length); index += 1) {
    const a = mine[index] ?? 0;
    const b = theirs[index] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

/** The version after this one: "0.7-draft" → "0.8", "1.9" → "1.10". */
export function nextVersion(version) {
  const numbers = versionNumbers(version);
  if (!numbers) return `${version}.1`;
  numbers[numbers.length - 1] += 1;
  return numbers.join(".");
}

/** The live version among published rows: the highest version number, as phones pick it. */
export function liveVersion(rows) {
  return rows
    .filter((row) => row.status === "published")
    .reduce((best, row) => (!best || isNewer(row.version, best.version) ? row : best), null);
}

/** "Display and software version" → "displayAndSoftwareVersion". */
export function slug(text) {
  const words = String(text ?? "")
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  if (words.length === 0) return "item";
  return words.map((word, index) => (index === 0 ? word : word[0].toUpperCase() + word.slice(1))).join("");
}

/** A key from a title, with a prefix, not already in `taken` ("physical.antenna", "physical.antenna2"). */
export function uniqueKey(title, taken, prefix = "") {
  const base = `${prefix}${slug(title)}`;
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}${n}`;
  return key;
}

/** Every check key in the checklist. */
export function itemKeys(content) {
  return new Set((content?.sections ?? []).flatMap((section) => (section.items ?? []).map((item) => item.key)));
}

/** A new check for a section, with a key no other check uses. */
export function newCheck(content, section, title = "New check") {
  return {
    key: uniqueKey(title, itemKeys(content), `${section.key}.`),
    title,
    purpose: "",
    steps: [""],
    lookFor: "",
    condition: "keyOn",
    required: true,
  };
}

/** A new section with a key no other section uses. */
export function newSection(content, title = "New section") {
  const taken = new Set((content?.sections ?? []).map((section) => section.key));
  return { key: uniqueKey(title, taken), title, summary: "", items: [] };
}

/** A deep copy of the live checklist as the start of the next version. */
export function draftFrom(liveContent, version) {
  const copy = JSON.parse(JSON.stringify(liveContent));
  copy.version = version;
  return copy;
}

/** Moves an element of an array by `offset` (-1 up, +1 down). Returns the new index. */
export function move(array, index, offset) {
  const target = index + offset;
  if (target < 0 || target >= array.length) return index;
  const [element] = array.splice(index, 1);
  array.splice(target, 0, element);
  return target;
}
