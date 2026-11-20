import { openShared } from "../../../lib/shared.mjs";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import {
  atomic,
  check,
  digest,
  verify,
  user,
  hash,
} from "../../../lib/store.mjs";
import { body, failure } from "../../../lib/http";
const dummy = hash(randomBytes(24).toString("hex"));
export async function POST(req: NextRequest) {
  const { db, finish } = await openShared(true);
  try {
    const p = await body(req);
    const options = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure:
        process.env.POS_HTTPS === "1" || req.nextUrl.protocol === "https:",
      path: "/",
    };
    if (p.action === "logout") {
      db.prepare("DELETE FROM tokens WHERE key=?").run(
        digest(req.cookies.get("pos")?.value || ""),
      );
      const r = NextResponse.json({ ok: true });
      r.cookies.set("pos", "", { ...options, maxAge: 0 });
      return r;
    }
    const change = p.action === "password";
    check(
      (change || p.action === "login") &&
        (change || (typeof p.name === "string" && p.name.length <= 50)) &&
        typeof p.password === "string" &&
        p.password.length <= 256,
    );
    const time = Date.now();
    const token = atomic(db, () => {
      const current = change ? user(db, req.cookies.get("pos")?.value) : null;
      check(!change || current, "Silakan masuk kembali.", 401);
      const name = change
        ? String(current.name).toLowerCase()
        : p.name.trim().toLowerCase();
      db.prepare("DELETE FROM attempts WHERE until<=?").run(time);
      const attempts = db
        .prepare("SELECT n FROM attempts WHERE name=?")
        .get(name);
      check(
        !attempts || Number(attempts.n) < 10,
        "Terlalu banyak percobaan. Coba lagi dalam 15 menit.",
        429,
      );
      const account = db
        .prepare("SELECT * FROM users WHERE name=? AND enabled=1")
        .get(name);
      if (!verify(p.password, account?.hash || dummy) || !account) {
        db.prepare(
          "INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(name) DO UPDATE SET n=n+1",
        ).run(name, time + 900000);
        return null;
      }
      if (change) {
        check(p.password !== p.newPassword, "Pilih kata sandi yang berbeda.");
        db.prepare("UPDATE users SET hash=? WHERE id=?").run(
          hash(p.newPassword),
          account.id,
        );
        db.prepare("DELETE FROM tokens WHERE uid=?").run(account.id);
      }
      db.prepare("DELETE FROM attempts WHERE name=?").run(name);
      db.prepare("DELETE FROM tokens WHERE expires<=?").run(time);
      const token = randomBytes(32).toString("hex");
      db.prepare("INSERT INTO tokens VALUES(?,?,?)").run(
        digest(token),
        account.id,
        time + 7 * 86400000,
      );
      return token;
    });
    check(token, "Username atau kata sandi salah.", 401);
    const r = NextResponse.json({ ok: true });
    r.cookies.set("pos", token, { ...options, maxAge: 7 * 86400 });
    return r;
  } catch (e) {
    return failure(e);
  } finally {
    await finish();
  }
}
