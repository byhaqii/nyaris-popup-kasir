import { openShared } from "../lib/shared.mjs";
import { atomic, hash, username } from "../lib/store.mjs";
import { randomBytes } from "node:crypto";
const { db, finish } = await openShared(true),
  name = username(process.argv[2] || "owner");
try {
  atomic(db, () => {
    if (db.prepare("SELECT id FROM users WHERE role='developer'").get())
      throw Error("Owner already initialized.");
    const password =
      process.env.POS_OWNER_PASSWORD || randomBytes(21).toString("base64url");
    db.prepare("INSERT INTO users(name,hash,role) VALUES(?,?,'developer')").run(
      name,
      hash(password),
    );
    console.log("Username:", name);
    if (!process.env.POS_OWNER_PASSWORD)
      console.log("Initial password:", password);
  });
} finally {
  await finish();
}
