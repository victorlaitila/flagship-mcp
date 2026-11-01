import { fileURLToPath } from 'node:url';

export const PORT = Number(process.env.PORT ?? 4000);
export const DATABASE_PATH = process.env.DATABASE_PATH ?? fileURLToPath(new URL('../data/flagship.db', import.meta.url));
