import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { open, dirty } from "../lib/store.mjs";
import { drain } from "../lib/sheets.mjs";
import { lockWorker } from "./worker-lock.mjs";
const dir = mkdtempSync(join(tmpdir(), "nyaris-delivery-"));
process.env.POS_DATA_DIR = dir;
process.env.GOOGLE_APPLICATION_CREDENTIALS = join(dir, "test.json");
const owner = "owner@example.invalid",
  robot = "sync@example.invalid",
  cashier = "cashier@example.invalid";
process.env.POS_GOOGLE_OWNER = owner;
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
writeFileSync(
  process.env.GOOGLE_APPLICATION_CREDENTIALS,
  JSON.stringify({ client_email: robot, private_key: privateKey }),
);
const db = open(),
  original = globalThis.fetch;
try {
  const guard = lockWorker(dir);
  assert.throws(() => lockWorker(dir), /already owns/);
  guard.close();
  lockWorker(dir).close();
  db.exec(`INSERT INTO events(id,name,bps) VALUES(1,'Test',1500);
 INSERT INTO users(id,name,hash,role) VALUES(1,'Cashier','fixture','cashier');
 INSERT INTO sessions(id,eid,uid,start) VALUES(1,1,1,'2026-01-01T00:00:00Z');
 INSERT INTO tenants(eid,name) VALUES(1,'A');
 INSERT INTO sales(id,eid,sid,tenant,amount,method,status) VALUES('voucher-one',1,1,'A',100,'Cash','paid')`);
  dirty(db, 1);
  db.exec("UPDATE sync SET file=kind");
  const remote = new Map(),
    writes = [];
  let privateShared = true,
    unavailable = false;
  globalThis.fetch = async (input, opts) => {
    const url = new URL(input);
    if (url.host === "oauth2.googleapis.com") {
      assert(opts.body.get("assertion").split(".").length === 3);
      return Response.json({ access_token: "test" });
    }
    assert.equal(opts.headers.Authorization, "Bearer test");
    const file = url.pathname.split("/").at(-1).split(":")[0];
    if (url.host === "www.googleapis.com") {
      const emails = [owner, robot];
      if (file === "private" && privateShared) emails.push(cashier);
      return Response.json({
        owners: [{ emailAddress: owner }],
        permissions: emails.map((emailAddress) => ({
          type: "user",
          emailAddress,
        })),
      });
    }
    assert.equal(url.host, "sheets.googleapis.com");
    const sheets = remote.get(file) || [];
    if (opts.method !== "POST")
      return Response.json({
        sheets: sheets.map((properties) => ({ properties })),
      });
    if (unavailable) return new Response("", { status: 503 });
    const { requests } = JSON.parse(opts.body);
    for (const r of requests)
      if (r.addSheet) sheets.push(r.addSheet.properties);
    remote.set(file, sheets);
    writes.push({ file, requests });
    return Response.json({});
  };
  await drain();
  assert.deepEqual(
    writes.map((w) => w.file),
    ["ops"],
  );
  assert.equal(
    db.prepare("SELECT done FROM sync WHERE kind='private'").get().done,
    0,
  );
  privateShared = false;
  db.exec("UPDATE sync SET next=0");
  await drain();
  assert.equal(writes.at(-1).file, "private");
  const first = writes[0].requests.find((r) => r.updateCells).updateCells;
  assert.equal(
    first.rows[1].values[0].userEnteredValue.stringValue,
    "voucher-one",
  );
  assert(!JSON.stringify(writes[0]).includes("Net tenant"));
  db.exec("UPDATE sales SET amount=200");
  dirty(db, 1);
  unavailable = true;
  await drain();
  assert.equal(
    db.prepare("SELECT count(*) n FROM sync WHERE done<revision").get().n,
    2,
  );
  unavailable = false;
  db.exec("UPDATE sync SET next=0");
  await drain();
  const corrected = writes.filter((w) => w.file === "ops").at(-1);
  assert(!corrected.requests.some((r) => r.addSheet));
  const update = corrected.requests[0].updateCells;
  assert.deepEqual(update.range, first.range);
  assert.equal(update.rows.length, 2);
  assert.equal(update.rows[1].values[3].userEnteredValue.numberValue, 200);
  assert.equal(
    db.prepare("SELECT count(*) n FROM sync WHERE done<revision").get().n,
    0,
  );
  console.log(
    "PASS: worker exclusivity and release, Google transport simulation, private access refusal, first delivery, outage recovery and correction in place.",
  );
} finally {
  globalThis.fetch = original;
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
