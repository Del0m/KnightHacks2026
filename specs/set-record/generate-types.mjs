// Writes types.ts from schema.json, so the phone and the API share one set of types (INT-01).
// No dependencies; handles only the JSON Schema keywords schema.json uses.
//
//   node specs/set-record/generate-types.mjs           rewrite types.ts
//   node --test specs/*.test.mjs                       fails when types.ts is stale

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = join(HERE, 'schema.json');
export const TYPES_PATH = join(HERE, 'types.ts');

const HEADER = `// Generated from schema.json by generate-types.mjs. Do not edit; run
// \`node specs/set-record/generate-types.mjs\` after changing the schema.
// Field meanings, units and clocks: docs/specs/set-record-format.md.
`;

const refName = (ref) => {
  const m = /^#\/\$defs\/(\w+)$/.exec(ref);
  if (!m) throw new Error(`unsupported $ref ${ref}`);
  return m[1];
};

const PRIMITIVE = { string: 'string', number: 'number', integer: 'number', boolean: 'boolean', null: 'null' };

/** A TS type expression for `node`. `indent` is the indent of the line the expression starts on. */
function typeOf(node, indent) {
  if (node.$ref) return refName(node.$ref);
  if ('const' in node) return JSON.stringify(node.const);
  if (node.enum) return node.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (node.oneOf) return node.oneOf.map((n) => typeOf(n, indent)).join(' | ');
  const types = [].concat(node.type ?? []);
  if (types.length === 0) throw new Error(`no type in ${JSON.stringify(node)}`);
  return types
    .map((t) => {
      if (t === 'array') {
        const item = typeOf(node.items, indent);
        return /[ |]/.test(item) ? `(${item})[]` : `${item}[]`;
      }
      if (t === 'object') return objectBody(node, indent);
      if (!(t in PRIMITIVE)) throw new Error(`unsupported type ${t}`);
      return PRIMITIVE[t];
    })
    .join(' | ');
}

function comment(text, indent) {
  return text ? `${indent}/** ${text} */\n` : '';
}

function objectBody(node, indent) {
  const inner = `${indent}  `;
  const required = new Set(node.required ?? []);
  const lines = Object.entries(node.properties ?? {}).map(
    ([key, prop]) =>
      `${comment(prop.description, inner)}${inner}${key}${required.has(key) ? '' : '?'}: ${typeOf(prop, inner)};\n`,
  );
  return `{\n${lines.join('')}${indent}}`;
}

export function generateTypes(schema) {
  const parts = Object.entries(schema.$defs).map(([name, def]) => {
    const doc = comment(def.description, '');
    return def.type === 'object'
      ? `${doc}export interface ${name} ${objectBody(def, '')}\n`
      : `${doc}export type ${name} = ${typeOf(def, '')};\n`;
  });
  return `${HEADER}\n${parts.join('\n')}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(TYPES_PATH, generateTypes(JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))));
  console.log(`wrote ${TYPES_PATH}`);
}
