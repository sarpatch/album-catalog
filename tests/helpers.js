import { readFileSync } from 'node:fs';
import { parseSchema } from '../js/schema.js';

/** Sovelluksen mukana tuleva oletusmäärittely. */
export function defaultSchema() {
  const { schema, warnings } = parseSchema(readFileSync(new URL('../kentat.json', import.meta.url), 'utf8'));
  if (warnings.length) throw new Error(warnings.join('; '));
  return schema;
}
