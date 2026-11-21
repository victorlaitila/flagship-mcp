import { fileURLToPath } from 'node:url';

export const PORT = Number(process.env.PORT ?? 4000);
export const DATABASE_PATH = process.env.DATABASE_PATH ?? fileURLToPath(new URL('../data/flagship.db', import.meta.url));

// A guardrail must not silently switch off on a typo, so anything but "true"/"false" stops startup.
const productionReadOnly = process.env.PRODUCTION_READ_ONLY ?? 'false';
if (productionReadOnly !== 'true' && productionReadOnly !== 'false') {
  throw new Error(`PRODUCTION_READ_ONLY must be "true" or "false", got "${productionReadOnly}".`);
}
export const PRODUCTION_READ_ONLY = productionReadOnly === 'true';

const storage = process.env.STORAGE ?? 'sqlite';
if (storage !== 'sqlite' && storage !== 'dynamodb') throw new Error(`STORAGE must be "sqlite" or "dynamodb", got "${storage}".`);
export const STORAGE = storage;
export const TABLE_NAME = process.env.TABLE_NAME ?? '';
if (STORAGE === 'dynamodb' && !TABLE_NAME) throw new Error('STORAGE=dynamodb needs TABLE_NAME.');
/** DynamoDB Local's URL; unset on AWS. */
export const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT || undefined;
