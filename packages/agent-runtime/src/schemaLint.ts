// Checks that a zod schema converts to JSON Schema both providers accept for
// structured output: Claude (draft-07 via the Agent SDK) and OpenAI strict
// mode (every property required, additionalProperties false, a restricted
// keyword set). Run in CI over every pipeline schema and tool input.

import { z } from 'zod';

/** Keywords OpenAI strict mode rejects or ignores in ways that change meaning. */
const UNSUPPORTED = new Set([
  'default',
  'not',
  'if',
  'then',
  'else',
  'dependentRequired',
  'dependentSchemas',
  'patternProperties',
  'propertyNames',
  'unevaluatedProperties',
  'unevaluatedItems',
  'minProperties',
  'maxProperties',
  'contains',
  'prefixItems',
]);

export interface SchemaProblem {
  path: string;
  message: string;
}

export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-7', io: 'output', unrepresentable: 'throw' }) as Record<string, unknown>;
}

export function lintSchema(schema: z.ZodType): SchemaProblem[] {
  let json: Record<string, unknown>;
  try {
    json = toJsonSchema(schema);
  } catch (e) {
    return [{ path: '$', message: `Not representable as JSON Schema: ${(e as Error).message}` }];
  }
  const problems: SchemaProblem[] = [];
  if (json.type !== 'object') problems.push({ path: '$', message: 'Top level must be an object' });
  walk(json, '$', problems);
  return problems;
}

function walk(node: unknown, path: string, problems: SchemaProblem[]) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((n, i) => {
      walk(n, `${path}[${i}]`, problems);
    });
    return;
  }
  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (UNSUPPORTED.has(key)) problems.push({ path, message: `Unsupported keyword "${key}"` });
  }
  const isObject = obj.type === 'object' || (Array.isArray(obj.type) && obj.type.includes('object'));
  if (isObject && obj.properties) {
    const props = Object.keys(obj.properties as object);
    const required = new Set((obj.required as string[] | undefined) ?? []);
    for (const p of props) {
      if (!required.has(p)) problems.push({ path: `${path}.${p}`, message: 'Optional property; use .nullable() instead of .optional()' });
    }
    if (obj.additionalProperties !== false)
      problems.push({ path, message: 'Objects must set additionalProperties: false (use z.object, not z.looseObject)' });
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'properties' && v && typeof v === 'object') {
      for (const [pk, pv] of Object.entries(v as object)) walk(pv, `${path}.${pk}`, problems);
    } else if (typeof v === 'object') {
      walk(v, `${path}.${k}`, problems);
    }
  }
}
