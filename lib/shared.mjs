import { Pool } from "pg";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { open } from "./store.mjs";

let pool;

export async function openShared(write) {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    if (process.env.VERCEL) throw Error("SUPABASE_DB_URL is required on Vercel");
    const db = open();
    return { db, finish: () => db.close() };
  }

  // shortcut: one database image per request suits a small demo; use native tables for larger events.
  pool ??= new Pool({ connectionString, ssl: { ca: readFileSync(join(process.cwd(), "supabase/prod-ca.crt"), "utf8"), rejectUnauthorized: true }, max: 3, connectionTimeoutMillis: 8000 });
  const client = await pool.connect();
  let dir, db;
  function cleanup() {
    try {
      if (dir) rmSync(dir, { recursive: true, force: true });
    } finally {
      client.release();
    }
  }
  try {
    await client.query("BEGIN");
    const query = "SELECT image FROM nyaris.store WHERE id = 1";
    const { rows } = await client.query(write ? query + " FOR UPDATE" : query);
    if (!rows.length) throw Error("Apply the Nyaris Supabase migration first");
    dir = mkdtempSync(join(tmpdir(), "nyaris-"));
    const path = join(dir, "nyaris.sqlite");
    if (rows[0].image) writeFileSync(path, rows[0].image, { mode: 0o600 });
    db = open(dir, true);
    return {
      db,
      async finish() {
        try {
          db.close();
          if (write) {
            const image = readFileSync(path);
            if (!rows[0].image?.equals(image))
              await client.query("UPDATE nyaris.store SET image=$1 WHERE id=1", [image]);
          }
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          cleanup();
        }
      },
    };
  } catch (error) {
    try { db?.close(); await client.query("ROLLBACK"); }
    finally { cleanup(); }
    throw error;
  }
}
