import assert from "node:assert/strict";

const base = new URL(process.env.POS_TEST_URL || "http://localhost:3000");
const password = process.env.POS_TEST_PASSWORD;
assert(password, "Set POS_TEST_PASSWORD for an existing account.");
assert(base.protocol === "https:" || ["localhost", "127.0.0.1"].includes(base.hostname));
const headers = { "Content-Type": "application/json", Origin: base.origin };
const request = (path, options) => fetch(new URL(path, base), { redirect: "manual", ...options });
const login = await request("/api/auth", {
  method: "POST", headers,
  body: JSON.stringify({ action: "login", name: process.env.POS_TEST_USERNAME || "owner", password }),
});
assert.equal(login.status, 200, "login rejected");
const cookie = login.headers.getSetCookie().find((value) => value.startsWith("pos="))?.split(";")[0];
assert(cookie, "session cookie missing");
try {
  const page = await request("/", { headers: { cookie } });
  assert.equal(page.status, 200, "cashier page rejected the new session");
  assert.equal((await request("/api/pos", { headers: { cookie } })).status, 200);
} finally {
  const result = await request("/api/auth", {
    method: "POST", headers: { ...headers, cookie }, body: JSON.stringify({ action: "logout" }),
  });
  assert.equal(result.status, 200);
}
const loggedOut = await request("/", { headers: { cookie } });
assert.equal(new URL(loggedOut.headers.get("location"), base).pathname, "/login");
console.log("PASS: login, cashier page, protected API, logout");
