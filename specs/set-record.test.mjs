// Tests for the shared set-record contract (INT-01): node --test specs/*.test.mjs
//
// - every fixtures/valid/<Def>/*.json passes its def, and fails once any required field is removed
// - hand-made invalid records fail
// - types.ts is what generate-types.mjs writes from schema.json
// - the Spark schemas in bronze.py match the JSON Schema (names and types)

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SCHEMA_PATH, TYPES_PATH, generateTypes } from './set-record/generate-types.mjs';
import { validateSchema } from './validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VALID_DIR = join(HERE, 'set-record', 'fixtures', 'valid');
const BRONZE_PATH = join(HERE, '..', 'databricks', 'pipelines', 'steadyforum_sessions', 'bronze.py');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const schema = readJson(SCHEMA_PATH);
const defs = schema.$defs;
const check = (value, def) => validateSchema(value, { $ref: `#/$defs/${def}` }, schema);
const clone = (v) => structuredClone(v);

/** Every fixture as { def, name, value }. */
const fixtures = readdirSync(VALID_DIR).flatMap((def) =>
  readdirSync(join(VALID_DIR, def))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ def, name: f, value: readJson(join(VALID_DIR, def, f)) })),
);

const resolve = (node) => (node.$ref ? resolve(defs[node.$ref.split('/').pop()]) : node);

/**
 * Paths (arrays of keys) to every required field in `value`, at every depth, following `node`.
 * Arrays contribute one item, the one with the most required fields inside (e.g. a rep with flags).
 */
function requiredPaths(value, node, prefix = []) {
  node = resolve(node);
  if (node.oneOf) {
    const match = node.oneOf.find((n) => validateSchema(value, n, schema).length === 0);
    return match ? requiredPaths(value, match, prefix) : [];
  }
  if (Array.isArray(value)) {
    if (!node.items) return [];
    return value
      .map((item, i) => requiredPaths(item, node.items, [...prefix, i]))
      .reduce((best, paths) => (paths.length > best.length ? paths : best), []);
  }
  if (value === null || typeof value !== 'object') return [];
  const out = [];
  for (const key of node.required ?? []) out.push([...prefix, key]);
  for (const [key, prop] of Object.entries(node.properties ?? {})) {
    if (key in value) out.push(...requiredPaths(value[key], prop, [...prefix, key]));
  }
  return out;
}

function without(value, path) {
  const copy = clone(value);
  const parent = path.slice(0, -1).reduce((v, k) => v[k], copy);
  delete parent[path.at(-1)];
  return copy;
}

describe('set-record fixtures', () => {
  it('has a valid fixture for every object def a payload uses', () => {
    const covered = new Set(fixtures.map((f) => f.def));
    for (const def of ['SetRecord', 'SessionStart', 'ExportSession', 'ExportMeta', 'ExportJointsLine']) {
      assert.ok(covered.has(def), `no fixture in fixtures/valid/${def}`);
    }
    for (const def of covered) assert.ok(def in defs, `fixtures/valid/${def} is not a $def`);
  });

  for (const { def, name, value } of fixtures) {
    it(`${def}/${name} is valid`, () => {
      assert.deepEqual(check(value, def), []);
    });

    it(`${def}/${name} fails without each required field`, () => {
      const paths = requiredPaths(value, { $ref: `#/$defs/${def}` });
      assert.ok(paths.length > 0);
      for (const path of paths) {
        const errors = check(without(value, path), def);
        assert.ok(
          errors.some((e) => e.includes(`/${path.join('/')}: is required`)),
          `removing ${path.join('.')} should fail, got ${JSON.stringify(errors)}`,
        );
      }
    });
  }

  for (const { name, value } of fixtures.filter((f) => f.def === 'SetRecord')) {
    it(`SetRecord/${name} keeps rep_index in step`, () => {
      value.reps.forEach((rep, i) => {
        assert.equal(rep.rep_index, i, 'rep_index is the array position');
        for (const flag of rep.flags) assert.equal(flag.rep_index, rep.rep_index);
        if (rep.start_ms !== null && rep.end_ms !== null) assert.equal(rep.end_ms - rep.start_ms, rep.tempo_ms);
        if (rep.lowering_ms !== null) assert.equal(rep.lowering_ms + rep.rising_ms, rep.tempo_ms);
      });
      const times = value.frames.map((f) => f.t_ms);
      assert.deepEqual(times, [...times].sort((a, b) => a - b), 'frames in time order');
      if (times.length) assert.equal(times[0], 0, 't_ms starts at the first kept frame');
    });
  }
});

describe('set-record rejects', () => {
  const base = readJson(join(VALID_DIR, 'SetRecord', 'minimal.json'));
  it('validates a set at the schema root', () => {
    assert.deepEqual(validateSchema(base, schema), []);
    assert.notDeepEqual(validateSchema({}, schema), []);
  });
  const cases = {
    'a 1-based or negative rep_index': (r) => (r.reps[0].rep_index = -1),
    'an unknown severity': (r) => (r.reps[1].flags[0].severity = 'info'),
    'a flag without rep_index': (r) => delete r.reps[1].flags[0].rep_index,
    'a frame with 50 values': (r) => r.frames[0].kp.pop(),
    'a fractional t_ms': (r) => (r.frames[1].t_ms = 66.7),
    'a non-finite joint': (r) => (r.frames[0].kp[0] = Infinity),
    'range_deg over 180': (r) => (r.reps[0].range_deg = 181),
    'a phone-side clean flag': (r) => (r.reps[0].clean = true),
    'a phone-side medal': (r) => (r.medal = 'gold'),
    'schema_version 2': (r) => (r.schema_version = 2),
    'an old exercise id': (r) => (r.exercise_id = 'Bicep Curl'),
    'an unknown end_reason': (r) => (r.end_reason = 'timeout'),
    'fps of 0': (r) => (r.fps = 0),
  };
  for (const [label, mutate] of Object.entries(cases)) {
    it(label, () => {
      const record = clone(base);
      mutate(record);
      assert.notDeepEqual(check(record, 'SetRecord'), []);
    });
  }

  it('the old inference_mode on_device', () => {
    assert.notDeepEqual(check({ inference_mode: 'on_device' }, 'SessionStart'), []);
  });
});

describe('types.ts', () => {
  it('is up to date with schema.json (run node specs/set-record/generate-types.mjs)', () => {
    assert.equal(readFileSync(TYPES_PATH, 'utf8'), generateTypes(schema));
  });
});

// ---------------------------------------------------------------------------
// bronze.py drift

/** Top-level `NAME = StructType([...])` assignments, parsed into { NAME: [{ name, type }] }. */
function parseSparkSchemas(source) {
  const text = source.replace(/#[^\n]*/g, '');
  const tokens = text.match(/"[^"]*"|[A-Za-z_]\w*|[()[\],=]/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = (expected) => {
    const t = tokens[i++];
    if (expected !== undefined && t !== expected) throw new Error(`expected ${expected}, got ${t}`);
    return t;
  };

  // type := XType() | ArrayType(type) | StructType([field, ...]) | NAME
  function type() {
    const t = next();
    if (t === 'ArrayType') {
      next('(');
      const item = type();
      next(')');
      return { array: item };
    }
    if (t === 'StructType') return { struct: structBody() };
    if (/Type$/.test(t)) {
      next('(');
      next(')');
      return t;
    }
    return { ref: t };
  }

  function structBody() {
    next('(');
    next('[');
    const fields = [];
    while (peek() !== ']') {
      next('StructField');
      next('(');
      const name = next().slice(1, -1);
      next(',');
      fields.push({ name, type: type() });
      next(')');
      if (peek() === ',') next(',');
    }
    next(']');
    next(')');
    return fields;
  }

  const out = {};
  for (i = 0; i < tokens.length; i++) {
    if (/^[A-Z][A-Z_]*$/.test(tokens[i]) && tokens[i + 1] === '=' && tokens[i + 2] === 'StructType') {
      const name = tokens[i];
      i += 3;
      out[name] = structBody();
      i -= 1;
    }
  }
  return out;
}

// Spark types each JSON Schema type may load as. Every ms field is a long.
const SPARK_FOR = {
  string: ['StringType'],
  integer: ['IntegerType', 'LongType'],
  number: ['DoubleType'],
  boolean: ['BooleanType'],
};

/** The JSON Schema type names of `node` other than null, following refs, enums and oneOf. */
function jsonTypes(node) {
  node = resolve(node);
  if (node.oneOf) return node.oneOf.flatMap(jsonTypes);
  if (node.enum) return [...new Set(node.enum.map((v) => (v === null ? 'null' : typeof v)))];
  if ('const' in node) return [Number.isInteger(node.const) ? 'integer' : typeof node.const];
  return [].concat(node.type).filter((t) => t !== 'null');
}

/** Problems comparing a Spark struct with a JSON Schema object def. `structs` resolves bronze names. */
function compareStruct(fields, node, structs, at) {
  node = resolve(node);
  const problems = [];
  const sparkNames = fields.map((f) => f.name);
  const jsonNames = Object.keys(node.properties);
  for (const n of jsonNames) if (!sparkNames.includes(n)) problems.push(`${at}.${n}: missing in bronze`);
  for (const n of sparkNames) if (!jsonNames.includes(n)) problems.push(`${at}.${n}: not in schema.json`);
  for (const f of fields) {
    if (f.name in node.properties) problems.push(...compareType(f.type, node.properties[f.name], structs, `${at}.${f.name}`));
  }
  return problems;
}

function compareType(sparkType, node, structs, at) {
  if (sparkType.ref) return compareType({ struct: structs[sparkType.ref] }, node, structs, at);
  const types = jsonTypes(node);
  if (types.length !== 1) return [`${at}: schema.json allows ${types.join(' and ')}`];
  const [t] = types;
  if (sparkType.array) {
    if (t !== 'array') return [`${at}: bronze has an array, schema.json has ${t}`];
    return compareType(sparkType.array, resolve(node).items, structs, `${at}[]`);
  }
  if (sparkType.struct) {
    if (t !== 'object') return [`${at}: bronze has a struct, schema.json has ${t}`];
    return compareStruct(sparkType.struct, node, structs, at);
  }
  return SPARK_FOR[t]?.includes(sparkType) ? [] : [`${at}: bronze has ${sparkType}, schema.json has ${t}`];
}

describe('bronze.py', () => {
  const structs = parseSparkSchemas(readFileSync(BRONZE_PATH, 'utf8'));
  const pairs = { FLAG: 'Flag', REP: 'Rep', SET: 'MetaSet', META_SCHEMA: 'ExportMeta', JOINTS_SCHEMA: 'ExportJointsLine' };

  for (const [spark, def] of Object.entries(pairs)) {
    it(`${spark} matches ${def}`, () => {
      assert.ok(structs[spark], `${spark} not found in bronze.py`);
      assert.deepEqual(compareStruct(structs[spark], defs[def], structs, spark), []);
    });
  }

  it('catches a drifted field', () => {
    const source = readFileSync(BRONZE_PATH, 'utf8').replace('StructField("tempo_ms", LongType())', 'StructField("tempo", LongType())');
    const drifted = parseSparkSchemas(source);
    const problems = compareStruct(drifted.REP, defs.Rep, drifted, 'REP');
    assert.ok(problems.includes('REP.tempo_ms: missing in bronze'));
    assert.ok(problems.includes('REP.tempo: not in schema.json'));
  });

  it('catches a drifted type', () => {
    const source = readFileSync(BRONZE_PATH, 'utf8').replace('StructField("range_deg", DoubleType())', 'StructField("range_deg", StringType())');
    const drifted = parseSparkSchemas(source);
    assert.deepEqual(compareStruct(drifted.REP, defs.Rep, drifted, 'REP'), [
      'REP.range_deg: bronze has StringType, schema.json has number',
    ]);
  });
});
