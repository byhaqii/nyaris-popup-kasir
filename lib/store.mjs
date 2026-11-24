import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
const initialized = new Set();
export function open(dir = process.env.POS_DATA_DIR || join(process.cwd(), "data"), temporary = false) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dir, "nyaris.sqlite"));
  db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON");
  if (initialized.has(dir)) return db;
  db.exec(`PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT UNIQUE COLLATE NOCASE,hash TEXT NOT NULL,role TEXT NOT NULL,enabled INTEGER DEFAULT 1);
 CREATE TABLE IF NOT EXISTS emails(uid INTEGER PRIMARY KEY REFERENCES users,email TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS tokens(key TEXT PRIMARY KEY,uid INTEGER REFERENCES users,expires INTEGER);
 CREATE TABLE IF NOT EXISTS attempts(name TEXT PRIMARY KEY,n INTEGER,until INTEGER);
 CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,name TEXT,start TEXT,finish TEXT,mode TEXT DEFAULT 'off',current INTEGER DEFAULT 0,bps INTEGER DEFAULT 0);
 CREATE UNIQUE INDEX IF NOT EXISTS current_event ON events(current) WHERE current=1;
 CREATE TABLE IF NOT EXISTS assignments(eid INTEGER REFERENCES events,uid INTEGER REFERENCES users,PRIMARY KEY(eid,uid));
 CREATE TABLE IF NOT EXISTS tenants(eid INTEGER REFERENCES events,name TEXT,enabled INTEGER DEFAULT 1,PRIMARY KEY(eid,name));
 CREATE TABLE IF NOT EXISTS tenant_staff(eid INTEGER,tenant TEXT,uid INTEGER,PRIMARY KEY(eid,tenant,uid),FOREIGN KEY(eid,tenant) REFERENCES tenants(eid,name),FOREIGN KEY(eid,uid) REFERENCES assignments(eid,uid) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY,eid INTEGER REFERENCES events,uid INTEGER REFERENCES users,start TEXT,end TEXT);
 DROP INDEX IF EXISTS live_session;
 CREATE UNIQUE INDEX IF NOT EXISTS live_cashier_session ON sessions(eid,uid) WHERE end IS NULL;
 CREATE TABLE IF NOT EXISTS sales(id TEXT PRIMARY KEY,eid INTEGER REFERENCES events,sid INTEGER REFERENCES sessions,tenant TEXT,amount INTEGER,method TEXT,created TEXT,updated TEXT,status TEXT,original TEXT,version INTEGER DEFAULT 1,FOREIGN KEY(eid,tenant) REFERENCES tenants(eid,name));
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,eid INTEGER REFERENCES events,actor INTEGER REFERENCES users,subject TEXT,action TEXT,reason TEXT,before TEXT,after TEXT,time TEXT);
 CREATE TABLE IF NOT EXISTS sync(eid INTEGER REFERENCES events,kind TEXT,file TEXT UNIQUE,revision INTEGER DEFAULT 1,done INTEGER DEFAULT 0,last TEXT,error TEXT,next INTEGER DEFAULT 0,PRIMARY KEY(eid,kind));`);
  db.exec(`CREATE TABLE IF NOT EXISTS proofs(
    id TEXT PRIMARY KEY,eid INTEGER NOT NULL REFERENCES events,uid INTEGER NOT NULL REFERENCES users,
    image BLOB NOT NULL,mime TEXT NOT NULL,created TEXT NOT NULL,
    sale_id TEXT UNIQUE REFERENCES sales(id)
  )`);
  db.exec(
    "CREATE TABLE IF NOT EXISTS changes(id INTEGER PRIMARY KEY, revision INTEGER NOT NULL); INSERT OR IGNORE INTO changes VALUES(1,0)",
  );
  for (const table of [
    "users",
    "emails",
    "events",
    "assignments",
    "tenant_staff",
    "tenants",
    "sessions",
    "sales",
    "audit",
    "sync",
  ]) {
    for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
      db.exec(
        `CREATE TRIGGER IF NOT EXISTS changed_${table}_${operation} AFTER ${operation} ON ${table} BEGIN UPDATE changes SET revision=revision+1 WHERE id=1; END`,
      );
    }
  }
  db.exec(
    "CREATE TABLE IF NOT EXISTS report_files(file TEXT PRIMARY KEY,eid INTEGER REFERENCES events,kind TEXT NOT NULL); INSERT OR IGNORE INTO report_files SELECT file,eid,kind FROM sync WHERE file IS NOT NULL",
  );
  const cutoff = now();
  db.prepare("UPDATE events SET mode=CASE WHEN start<=? AND finish>? THEN 'on' ELSE 'off' END WHERE mode='auto'").run(cutoff, cutoff);
  if (!temporary) initialized.add(dir);
  return db;
}
export function atomic(db, fn, write = true) {
  db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function check(ok, message = "Permintaan tidak valid.", status = 400) {
  if (!ok) throw Object.assign(new Error(message), { status });
}
export const now = () => new Date().toISOString();
export const day = (s) =>
  new Date(new Date(s).getTime() + 7 * 3600000).toISOString().slice(0, 10);
export const digest = (s) => createHash("sha256").update(s).digest("hex");
export function hash(password) {
  check(
    typeof password === "string" &&
      password.length >= 8 &&
      password.length <= 256,
    "Gunakan kata sandi 8–256 karakter.",
  );
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function verify(password, stored) {
  const [salt, key] = stored.split(":");
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(key, "hex"),
  );
}
export function user(db, token) {
  return db
    .prepare(
      "SELECT u.id,u.name,u.role FROM tokens t JOIN users u ON u.id=t.uid WHERE t.key=? AND t.expires>? AND u.enabled=1",
    )
    .get(digest(token || ""), Date.now());
}
export const active = (e) => !!e?.current && e.mode === "on";
export const clean = (v, max = 100) => {
  check(typeof v === "string" && v.trim().length > 0 && v.trim().length <= max);
  return v.trim();
};
export function username(v) {
  v = clean(v, 50);
  check(
    /^[a-zA-Z0-9_.-]{2,50}$/.test(v),
    "Username harus 2–50 karakter (huruf, angka, _, ., -).",
  );
  return v;
}
export function audit(db, eid, actor, subject, action, reason, before, after) {
  db.prepare(
    "INSERT INTO audit(eid,actor,subject,action,reason,before,after,time) VALUES(?,?,?,?,?,?,?,?)",
  ).run(
    eid,
    actor,
    String(subject),
    action,
    reason,
    JSON.stringify(before),
    JSON.stringify(after),
    now(),
  );
}
export function dirty(db, eid, types = ["ops", "private"]) {
  for (const kind of types)
    db.prepare(
      "INSERT INTO sync(eid,kind) VALUES(?,?) ON CONFLICT(eid,kind) DO UPDATE SET revision=revision+1,next=0",
    ).run(eid, kind);
}
