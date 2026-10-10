// Validates specs/exercises/*.json: shape against schema.json, then the semantic and tone rules
// in docs/specs/exercise-spec-format.md. No dependencies.
//
//   node specs/validate.mjs            validate every spec, exit 1 on errors
//   node --test specs/*.test.mjs       unit tests

import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXERCISES_DIR = join(HERE, 'exercises');

export const INJURIES = ['knee', 'shoulder', 'lower_back'];
export const NOTE_PLACEHOLDERS = ['n', 'total', 'value', 't'];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export const loadSchema = () => readJson(join(EXERCISES_DIR, 'schema.json'));
export const loadBanned = () => readJson(join(HERE, 'banned-phrases.json'));

/** Every spec in specs/exercises, as { fileId, spec }, sorted by file name. */
export function loadSpecs() {
  return readdirSync(EXERCISES_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'schema.json')
    .sort()
    .map((f) => ({ fileId: basename(f, '.json'), spec: readJson(join(EXERCISES_DIR, f)) }));
}

// ---------------------------------------------------------------------------
// JSON Schema subset: the keywords schema.json uses, nothing more.

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

function matchesType(value, type) {
  if (type === 'integer') return Number.isInteger(value);
  return typeOf(value) === type;
}

function resolveRef(ref, root) {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref ${ref}`);
  return ref
    .slice(2)
    .split('/')
    .reduce((node, key) => node[key], root);
}

/** Returns a list of "path: problem" strings; empty when `value` matches `schema`. */
export function validateSchema(value, schema, root = schema, path = '') {
  const at = path || '/';
  if (schema.$ref) return validateSchema(value, resolveRef(schema.$ref, root), root, path);

  const errors = [];
  if ('const' in schema && value !== schema.const) {
    errors.push(`${at}: must be ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${at}: must be one of ${schema.enum.join(', ')}`);
  }
  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${at}: must be ${schema.type}`);
    return errors;
  }
  if (schema.oneOf) {
    const passing = schema.oneOf.filter((s) => validateSchema(value, s, root, path).length === 0);
    if (passing.length !== 1) {
      errors.push(`${at}: must match exactly one allowed form (matched ${passing.length})`);
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${at}: shorter than ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${at}: longer than ${schema.maxLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${at}: does not match ${schema.pattern}`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: above ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      errors.push(`${at}: must be above ${schema.exclusiveMinimum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${at}: needs at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${at}: allows at most ${schema.maxItems} items`);
    }
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) {
      errors.push(`${at}: items must be unique`);
    }
    if (schema.items) {
      value.forEach((item, i) => errors.push(...validateSchema(item, schema.items, root, `${path}/${i}`)));
    }
  }

  if (typeOf(value) === 'object') {
    const keys = Object.keys(value);
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}/${key}: is required`);
    }
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
      errors.push(`${at}: needs at least ${schema.minProperties} properties`);
    }
    for (const key of keys) {
      const child = `${path}/${key}`;
      if (schema.propertyNames) errors.push(...validateSchema(key, schema.propertyNames, root, child));
      if (schema.properties && key in schema.properties) {
        errors.push(...validateSchema(value[key], schema.properties[key], root, child));
      } else if (schema.additionalProperties === false) {
        errors.push(`${child}: is not allowed`);
      } else if (typeOf(schema.additionalProperties) === 'object') {
        errors.push(...validateSchema(value[key], schema.additionalProperties, root, child));
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Tone rules (Architecture §7)

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalize = (text) => text.replace(/[‘’]/g, "'");

/**
 * Problems with a note's phrasing, or [] if it reads as a description rather than a command.
 * `placeholders` lists the {names} allowed in this note.
 */
export function checkNote(text, banned, { placeholders = NOTE_PLACEHOLDERS } = {}) {
  const problems = [];
  const plain = normalize(text);

  for (const phrase of banned.phrases) {
    const re = new RegExp(`(^|[^a-z'])${escapeRegExp(phrase)}(?![a-z'])`, 'i');
    if (re.test(plain)) problems.push(`uses banned phrase "${phrase}"`);
  }

  for (const sentence of plain.split(/(?<=[.?!])\s+/)) {
    const first = sentence.match(/^[^a-z{]*([a-z']+)/i)?.[1]?.toLowerCase();
    if (first && banned.imperative_openers.includes(first)) {
      problems.push(`sentence opens with imperative "${first}": "${sentence.trim()}"`);
    }
  }

  if (plain.includes('!')) problems.push('uses an exclamation mark');

  for (const [, name] of plain.matchAll(/\{([^}]*)\}/g)) {
    if (!placeholders.includes(name)) problems.push(`placeholder {${name}} is not allowed here`);
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Semantic checks

const UNSIDED = new Set(['eye', 'ear', 'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle']);

function anglePoints(angle) {
  if (angle.type === 'joint_angle') return angle.joints;
  if (angle.type === 'segment_tilt') return [angle.from, angle.to];
  return [];
}

function phaseOrderProblem(phases, direction) {
  const { target, count_min: countMin, start_exit: exit, start_enter: enter } = phases;
  if (direction === 'decreasing') {
    return target <= countMin && countMin < exit && exit < enter
      ? null
      : `thresholds must satisfy target <= count_min < start_exit < start_enter for decreasing (got ${target}, ${countMin}, ${exit}, ${enter})`;
  }
  return target >= countMin && countMin > exit && exit > enter
    ? null
    : `thresholds must satisfy target >= count_min > start_exit > start_enter for increasing (got ${target}, ${countMin}, ${exit}, ${enter})`;
}

/**
 * The spec as it applies to a user with one injury: phases merged, rule patches applied,
 * disabled rules removed. Does not mutate `spec`.
 */
export function applyOverride(spec, injury) {
  const override = spec.injury_overrides[injury] ?? {};
  const disabled = new Set(override.disable_rules ?? []);
  const patches = override.rules ?? {};
  return {
    ...spec,
    phases: { ...spec.phases, ...override.phases },
    rules: spec.rules
      .filter((rule) => !disabled.has(rule.id))
      .map((rule) => {
        const patch = patches[rule.id];
        if (!patch) return rule;
        const { value, ...rest } = patch;
        return {
          ...rule,
          ...rest,
          check: value === undefined ? rule.check : { ...rule.check, value },
        };
      }),
  };
}

function noteErrors(where, text, banned, placeholders) {
  return checkNote(text, banned, { placeholders }).map((p) => `${where}: ${p}`);
}

/** All problems with one spec; [] when it is valid. `fileId` is the file name without .json. */
export function validateSpec(spec, { schema, banned, fileId }) {
  const shape = validateSchema(spec, schema);
  if (shape.length) return shape;

  const errors = [];
  const ruleIds = new Set();
  const priorities = new Set();
  const durationRules = new Set();

  if (fileId !== undefined && spec.id !== fileId) {
    errors.push(`id "${spec.id}" does not match file ${fileId}.json`);
  }

  for (const [name, angle] of Object.entries(spec.angles)) {
    const unsided = anglePoints(angle).filter((p) => UNSIDED.has(p));
    if (unsided.length && !angle.side) {
      errors.push(`angles.${name}: unsided point "${unsided[0]}" needs a side`);
    }
  }

  const primary = spec.angles[spec.primary_angle.name];
  if (!primary) {
    errors.push(`primary_angle: "${spec.primary_angle.name}" is not defined in angles`);
  } else if (primary.type !== 'joint_angle') {
    errors.push(`primary_angle: "${spec.primary_angle.name}" must be a joint_angle`);
  }

  const direction = spec.primary_angle.direction;
  const baseOrder = phaseOrderProblem(spec.phases, direction);
  if (baseOrder) errors.push(`phases: ${baseOrder}`);

  for (const rule of spec.rules) {
    const where = `rules.${rule.id}`;
    if (ruleIds.has(rule.id)) errors.push(`duplicate rule id "${rule.id}"`);
    ruleIds.add(rule.id);
    if (priorities.has(rule.priority)) errors.push(`${where}: duplicate priority ${rule.priority}`);
    priorities.add(rule.priority);

    const { metric, reduce } = rule.check;
    if (metric === 'duration_ms') {
      durationRules.add(rule.id);
      if (reduce !== undefined) errors.push(`${where}: duration_ms takes no reduce`);
    } else if (!spec.angles[metric]) {
      errors.push(`${where}: unknown metric "${metric}"`);
    } else if (reduce === undefined) {
      errors.push(`${where}: angle metric "${metric}" needs reduce`);
    }

    const placeholders = durationRules.has(rule.id) ? NOTE_PLACEHOLDERS : ['n', 'total', 'value'];
    errors.push(...noteErrors(`${where}.rest_note`, rule.rest_note, banned, placeholders));
  }

  for (const injury of INJURIES) {
    const override = spec.injury_overrides[injury];
    const where = `injury_overrides.${injury}`;
    const patched = Object.keys(override.rules ?? {});

    for (const id of [...patched, ...(override.disable_rules ?? [])]) {
      if (!ruleIds.has(id)) errors.push(`${where}: unknown rule "${id}"`);
    }
    for (const id of override.disable_rules ?? []) {
      if (patched.includes(id)) errors.push(`${where}: both patches and disables "${id}"`);
    }
    for (const [id, patch] of Object.entries(override.rules ?? {})) {
      if (patch.rest_note !== undefined) {
        const placeholders = durationRules.has(id) ? NOTE_PLACEHOLDERS : ['n', 'total', 'value'];
        errors.push(...noteErrors(`${where}.rules.${id}.rest_note`, patch.rest_note, banned, placeholders));
      }
    }
    errors.push(...noteErrors(`${where}.extra_note`, override.extra_note, banned, []));

    const order = phaseOrderProblem(applyOverride(spec, injury).phases, direction);
    if (order) errors.push(`${where}: ${order}`);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// CLI

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const schema = loadSchema();
  const banned = loadBanned();
  let failed = 0;
  for (const { fileId, spec } of loadSpecs()) {
    const errors = validateSpec(spec, { schema, banned, fileId });
    if (errors.length) {
      failed++;
      console.log(`✗ ${fileId}.json`);
      for (const e of errors) console.log(`    ${e}`);
    } else {
      console.log(`✓ ${fileId}.json`);
    }
  }
  process.exit(failed ? 1 : 0);
}
