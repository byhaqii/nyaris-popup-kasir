import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { open, day } from "./lib/store.mjs";
import { pendingPayment, receiptMessage } from "./lib/payment.mjs";
import { records } from "./lib/pos.mjs";
import { drain, tables } from "./lib/sheets.mjs";
const dir = mkdtempSync(join(tmpdir(), "nyaris-test-"));
process.env.POS_DATA_DIR = dir;
const pwd = randomUUID(),
  env = { ...process.env, POS_OWNER_PASSWORD: pwd };
execFileSync(process.execPath, ["scripts/owner.mjs", "owner"], { env });
const legacy = open(dir);
legacy.exec("DROP INDEX live_cashier_session; CREATE UNIQUE INDEX live_session ON sessions(eid) WHERE end IS NULL");
legacy.close();
const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "0"],
  { env, stdio: ["ignore", "pipe", "inherit"] },
);
let log = "",
  base = "";
server.stdout.on("data", (chunk) => {
  log += chunk;
  base = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0] || "";
});
const users = {};
async function post(path, who, data, status = 200) {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: users[who] || "" },
    body: JSON.stringify(data),
  });
  const out = await r.json();
  assert.equal(r.status, status, JSON.stringify(out));
  return { r, out };
}
const login = async (name) => {
  const { r } = await post("/api/auth", name, {
    action: "login",
    name,
    password: pwd,
  });
  users[name] = r.headers.get("set-cookie").split(";")[0];
  assert.match(r.headers.get("set-cookie"), /HttpOnly/i);
};
let eid;
const act = async (who, action, fields = {}, code = 200) =>
  (await post("/api/pos", who, { eid, action, ...fields }, code)).out;
try {
  for (let n = 0; n < 100 && !log.includes("Ready"); n++) await sleep(100);
  assert(base);
  assert.equal((await fetch(base, { redirect: "manual" })).status, 307);
  assert.equal((await fetch(base + "/api/pos")).status, 401);
  await post(
    "/api/auth",
    "",
    { action: "login", name: "owner", password: "bad" },
    401,
  );
  await login("owner");
  await act("owner", "account", { name: "short-test", password: "1234567" }, 400);
  await act("owner", "account", { name: "eight-test", password: "12345678", role: "developer" });
  const home = await fetch(base, { headers: { cookie: users.owner } });
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Meja kasir/);
  for (const name of ["anna", "budi"])
    await act("owner", "account", { name, password: pwd });
  await act("owner", "account", { name: "invalid", role: "admin", password: pwd }, 400);
  await act("owner", "account", { name: "rekan", role: "developer", password: pwd });
  await login("rekan");
  await login("anna");
  await act("anna", "account", { name: "forbidden", role: "developer", password: pwd }, 403);
  let state = await act("rekan", "event", {
    name: "Acceptance",
    tenantNames: " Tenant A \nTenant B\n tenant a\n",
  });
  assert.deepEqual(
    state.tenants.map((t) => t.name),
    ["Tenant A", "Tenant B"],
  );
  eid = state.event.id;
  const employeeState = await (await fetch(base + "/api/pos", {
    headers: { cookie: users.anna },
  })).json();
  assert.equal(employeeState.event.id, eid);
  assert(employeeState.events.some(event => event.id === eid));
  const anna = state.admin.users.find(user => user.name === "anna");
  await act("owner", "tenantStaff", { uid: anna.id, tenant: "Tenant A", enabled: true });
  await act("owner", "tenant", { name: "Tenant A", enabled: true });
  state = await act("owner", "tenant", { name: "tenant a", enabled: true });
  assert.deepEqual(
    state.tenants.map((t) => t.name),
    ["Tenant A", "Tenant B"],
  );
  await login("anna");
  await login("budi");
  await act("owner", "staff", {
    uid: state.admin.users.find((u) => u.name === "anna").id,
    email: "anna@example.invalid",
    enabled: true,
  });
  const poll = () =>
    fetch(base + "/api/pos", { headers: { cookie: users.anna } });
  const tag = (await poll()).headers.get("etag");
  assert(tag);
  assert.equal(
    (
      await fetch(base + "/api/pos", {
        headers: { cookie: users.anna, "If-None-Match": tag },
      })
    ).status,
    304,
  );
  await act("anna", "start", {}, 409);
  await act("anna", "mode", { mode: "on" }, 403);
  await act("owner", "mode", { mode: "on" });
  const starts = await Promise.all(
    ["anna", "budi"].map(async (name) => ({
      name,
      r: await fetch(base + "/api/pos", {
        method: "POST",
        headers: { cookie: users[name], "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", eid }),
      }),
    })),
  );
  assert.deepEqual(starts.map((x) => x.r.status).sort(), [200, 200]);
  const first = starts.find((x) => x.r.ok),
    cashier = first.name,
    other = cashier === "anna" ? "budi" : "anna";
  state = await first.r.json();
  const sid = state.sessions.find(session => session.cashier === cashier && !session.end).id;
  await act(cashier, "start", {}, 409);
  const sale = {
    id: randomUUID(),
    sid,
    tenant: "Tenant A",
    amount: 1000000,
    method: "QRIS",
  };
  await act(other, "sale", sale, 409);
  await act(cashier, "sale", { ...sale, amount: 0 }, 400);
  await act(cashier, "sale", { ...sale, amount: -1 }, 400);
  const map = new Map(),
    storage = {
      getItem: (k) => map.get(k) || null,
      setItem: (k, v) => map.set(k, v),
    };
  const confirmed = pendingPayment(storage, "pending", { ...sale, eid });
  sale.id = confirmed.id;
  const lookup = async () => {
    const r = await fetch(
      base + "/api/pos?event=" + eid + "&receipt=" + sale.id,
      { headers: { cookie: users[cashier] } },
    );
    assert.equal(r.status, 200);
    return (await r.json()).receipt;
  };
  assert.equal(await lookup(), null);
  assert.equal(await lookup(), null);
  await act(cashier, "sale", sale); // response lost after commit
  assert.equal((await lookup()).amount, sale.amount);
  const restored = pendingPayment(storage, "pending", {
    ...sale,
    amount: 5,
    eid,
  });
  assert.deepEqual(restored, confirmed);
  state = await act(cashier, "sale", restored);
  assert.match(receiptMessage(restored, state.receipt), /boleh distempel/);
  assert.equal(state.sales.length, 1);
  await act(cashier, "sale", {
    ...sale,
    id: randomUUID(),
    method: "Cash",
    amount: 5000,
  });
  await act(cashier, "end", { sid });
  await act(cashier, "sale", { ...sale, id: randomUUID() }, 409);
  await act("owner", "mode", { mode: "off" });
  state = await act(other, "edit", {
    ...sale,
    method: "Cash",
    version: 1,
    reason: "Wrong method",
  });
  assert.equal(state.sales.find((s) => s.id === sale.id).cashier, cashier);
  assert.equal(state.audits[0].actor, other);
  assert.match(
    receiptMessage(sale, (await act(cashier, "sale", sale)).receipt),
    /dikoreksi/,
  );
  await act(other, "edit", { ...sale, version: 1, reason: "Stale" }, 409);
  const extra = state.sales.find((s) => s.id !== sale.id);
  state = await act(other, "cancel", {
    id: extra.id,
    version: 1,
    reason: "Duplicate physical voucher",
  });
  assert.equal(state.sales.find((s) => s.id === extra.id).status, "cancelled");
  assert.match(
    receiptMessage(
      { ...sale, id: extra.id, method: "Cash", amount: 5000 },
      (
        await act(cashier, "sale", {
          ...sale,
          id: extra.id,
          method: "Cash",
          amount: 5000,
        })
      ).receipt,
    ),
    /Jangan stempel/,
  );
  state = await act("owner", "share", { bps: 1500 });
  assert.deepEqual(state.admin.sharing[0], {
    name: "Tenant A",
    gross: 1000000,
    share: 150000,
    net: 850000,
  });
  const db = open();
  db.prepare(
    "UPDATE sales SET created='2020-01-01T00:00:00.000Z' WHERE id=?",
  ).run(sale.id);
  await act(
    other,
    "cancel",
    { id: sale.id, version: 2, reason: "Too late" },
    403,
  );
  await act("owner", "edit", {
    ...sale,
    version: 2,
    reason: "Historical correction",
  });
  await act("owner", "destination", {
    file: "test_ops_file_id_only",
    kind: "ops",
  });
  await act(
    "owner",
    "destination",
    { file: "test_ops_file_id_only", kind: "private" },
    400,
  );
  await act("owner", "destination", {
    file: "test_private_file_id_only",
    kind: "private",
  });
  await act("owner", "destination", {
    file: "replacement_ops_file",
    kind: "ops",
  });
  await act(
    "owner",
    "destination",
    { file: "test_ops_file_id_only", kind: "private" },
    400,
  );
  const staffView = await (
    await fetch(base + "/api/pos", { headers: { cookie: users[other] } })
  ).json();
  for (const field of ['"admin"', '"bps"', "test_private", '"share"'])
    assert(!JSON.stringify(staffView).includes(field));
  const pub = tables(records(db, eid), "ops", 1500);
  assert(!JSON.stringify(pub).includes("150000"));
  assert.equal(pub.Transaksi.length, 3);
  await drain(async () => {
    throw Error("Simulated outage");
  });
  assert(db.prepare("SELECT error FROM sync LIMIT 1").get().error);
  db.exec("UPDATE sync SET next=0");
  await drain(async () => {});
  assert.equal(
    db.prepare("SELECT count(*) n FROM sync WHERE done<revision").get().n,
    0,
  );
  await act(
    "owner",
    "destination",
    { file: "new_destination_file", kind: "ops" },
    400,
  );
  assert.equal(day("2026-11-20T17:00:00Z"), "2026-11-21");
  await act("owner", "rename", {name: "Acceptance"});
  await act("owner", "mode", { mode: "auto" }, 400);
  state = await act("owner", "mode", { mode: "on" });
  assert.equal(state.event.active, true);
  await act("owner", "start");
  state = await act("owner", "mode", { mode: "off" });
  assert.equal(state.event.active, false);
  assert(state.sessions.every(session => session.end));
  const directSale = { id: randomUUID(), tenant: "Tenant A", amount: 1000, method: "Cash" };
  await act("owner", "sale", directSale, 409);
  await act("owner", "mode", { mode: "on" });
  for (const who of ["owner", "rekan"]) {
    const request = { ...directSale, id: randomUUID() };
    await act(who, "sale", request);
    const retried = await act(who, "sale", request);
    const matches = retried.sales.filter(row => row.id === request.id);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].cashier, who);
  }
  await act("owner", "mode", { mode: "off" });
  const otherEvent = await act("owner", "event", {
    name: "Other",
  });
  const otherEmployeeState = await (await fetch(
    base + "/api/pos?event=" + otherEvent.event.id,
    { headers: { cookie: users[other] } },
  )).json();
  assert.equal(otherEmployeeState.event.id, otherEvent.event.id);
  await act(other, "start", { eid: otherEvent.event.id }, 409);
  const photoEvent = otherEvent.event.id;
  await act("owner", "current", { eid: photoEvent });
  await act("owner", "mode", { eid: photoEvent, mode: "on" });
  await act("owner", "tenant", { eid: photoEvent, name: "Photo tenant", enabled: true });
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQAASABIAAD/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAA" +
    "AAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKB" +
    "kaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZn" +
    "aGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT" +
    "1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcI" +
    "CQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAV" +
    "YnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6" +
    "goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk" +
    "5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoK" +
    "CgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/9sAQwECAgIEBAQHBAQHEAsJCxAQEBAQEBAQEBAQ" +
    "EBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ/90ABAAB/9oADAMBAAIRAxEA" +
    "PwD9/KKKKAP/2Q==",
    "base64",
  );
  async function uploadPhoto(who, bytes = jpeg, expected = 200) {
    const form = new FormData();
    form.set("event", String(photoEvent));
    form.set("photo", new Blob([bytes], { type: "image/jpeg" }), "proof.jpg");
    const response = await fetch(base + "/api/proofs", { method: "POST", headers: { cookie: users[who] || "" }, body: form });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result.id;
  }
  await uploadPhoto("", jpeg, 401);
  await uploadPhoto(cashier, Buffer.from("invalid image"), 415);
  await uploadPhoto(cashier, Buffer.alloc(600000), 413);
  const photoA = await uploadPhoto(cashier);
  const photoB = await uploadPhoto(other);
  assert.equal((await fetch(base + "/api/proofs/" + photoA)).status, 401);
  assert.equal((await fetch(base + "/api/proofs/" + photoA, { headers: { cookie: users[other] } })).status, 404);
  await act(other, "sale", { eid: photoEvent, id: randomUUID(), tenant: "Photo tenant", amount: 1000, method: "Cash", proofId: photoA }, 400);
  const simultaneous = [
    { who: cashier, proofId: photoA, method: "QRIS" },
    { who: other, proofId: photoB, method: "Cash" },
  ].map(row => ({ ...row, id: randomUUID() }));
  await Promise.all(simultaneous.map(row => act(row.who, "sale", { eid: photoEvent, id: row.id, tenant: "Photo tenant", amount: 1000, method: row.method, proofId: row.proofId })));
  for (const row of simultaneous) {
    const result = await act(row.who, "sale", { eid: photoEvent, id: row.id, tenant: "Photo tenant", amount: 1000, method: row.method, proofId: row.proofId });
    const saved = result.sales.filter(sale => sale.id === row.id);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].cashier, row.who);
    assert.equal(saved[0].proofId, row.proofId);
    const response = await fetch(base + "/api/proofs/" + row.proofId, { headers: { cookie: users[row.who] } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
  }
  await act(cashier, "sale", { eid: photoEvent, id: randomUUID(), tenant: "Photo tenant", amount: 1000, method: "QRIS", proofId: photoA }, 400);
  process.env.POS_PUBLIC_URL = base;
  const photoReport = tables(records(db, photoEvent), "ops", 0);
  assert.equal(photoReport.Transaksi[0].at(-1), "Bukti pembayaran");
  assert(photoReport.Transaksi.slice(1).every(row => row.at(-1).startsWith(base + "/api/proofs/")));
  const token = users[other];
  await post("/api/auth", other, { action: "logout" });
  assert.equal(
    (await fetch(base + "/api/pos", { headers: { cookie: token } })).status,
    401,
  );
  assert.equal(
    db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  const replacement = randomUUID();
  await post(
    "/api/auth",
    "owner",
    { action: "password", password: "incorrect", newPassword: replacement },
    401,
  );
  await post("/api/auth", "owner", {
    action: "password",
    password: pwd,
    newPassword: replacement,
  });
  assert.equal(
    (await fetch(base + "/api/pos", { headers: { cookie: users.owner } }))
      .status,
    401,
  );
  await post(
    "/api/auth",
    "",
    { action: "login", name: "owner", password: pwd },
    401,
  );
  await post("/api/auth", "", {
    action: "login",
    name: "owner",
    password: replacement,
  });
  db.close();
  console.log(
    "PASS: protected HTTP routes, roles, automatic employee event access, manual event controls, concurrent sessions and payments, photo uploads, protected photo access, retries, corrections, reports, logout, persistent sync retry and SQLite integrity.",
  );
} finally {
  const exited = once(server, "exit");
  server.kill();
  await exited;
  rmSync(dir, { recursive: true, force: true });
}
