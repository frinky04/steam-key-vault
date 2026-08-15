import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "@/lib/env";

export type Db = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __db?: Db };

function createDb(): Db {
  const client = postgres(env.DATABASE_URL, {
    max: 10,
    prepare: false,
    onnotice: () => {},
  });
  return drizzle(client, { schema });
}

/**
 * Lazily-initialised singleton. Nothing connects (or reads DATABASE_URL) until
 * the first query, so `next build` works without secrets present.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    if (!globalForDb.__db) globalForDb.__db = createDb();
    const value = Reflect.get(globalForDb.__db, prop, receiver);
    return typeof value === "function" ? value.bind(globalForDb.__db) : value;
  },
});

export { schema };
