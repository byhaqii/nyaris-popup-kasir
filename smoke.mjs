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
  for (const u of state.admin.users.filter(u => u.role === "cashier"))
    await act("owner", "assign", { uid: u.id, enabled: true });
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
  assert.deepEqual(starts.map((x) => x.r.status).sort(), [200, 409]);
  const first = starts.find((x) => x.r.ok),
    cashier = first.name,
    other = cashier === "anna" ? "budi" : "anna";
  state = await first.r.json();
  const sid = state.sessions[0].id;
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
  const otherEvent = await act("owner", "event", {
    name: "Other",
  });
  await act(other, "start", { eid: otherEvent.event.id }, 403);
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
    "PASS: protected HTTP routes, roles, assignment, manual event controls, concurrent sessions, payments, retries, corrections, reports, logout, persistent sync retry and SQLite integrity.",
  );
} finally {
  const exited = once(server, "exit");
  server.kill();
  await exited;
  rmSync(dir, { recursive: true, force: true });
}
