import { grossSales } from "./sales.mjs";
import {
  check,
  active,
  now,
  day,
  clean,
  hash,
  username,
  audit,
  dirty,
} from "./store.mjs";
export function scope(db, u, id) {
  const event = id
    ? db.prepare("SELECT * FROM events WHERE id=?").get(Number(id))
    : db.prepare("SELECT * FROM events WHERE current=1").get();
  if (!event) return null;
  return event;
}
export function records(db, id) {
  const sales = db
    .prepare(
      "SELECT t.id,t.sid,t.tenant,t.amount,t.method,t.created,t.updated,t.status,t.version,u.name cashier,p.id proofId FROM sales t JOIN sessions s ON t.sid=s.id JOIN users u ON u.id=s.uid LEFT JOIN proofs p ON p.sale_id=t.id WHERE t.eid=? ORDER BY t.created DESC,t.rowid DESC",
    )
    .all(id);
  const sessions = db
    .prepare(
      "SELECT s.id,s.uid,s.start,s.end,u.name cashier FROM sessions s JOIN users u ON u.id=s.uid WHERE s.eid=? ORDER BY s.id DESC",
    )
    .all(id);
  const tenants = db
    .prepare("SELECT name,enabled FROM tenants WHERE eid=? ORDER BY rowid")
    .all(id);
  return { sales, sessions, tenants };
}
export function sharing(records, bps) {
  return records.tenants.map(({ name }) => {
    const gross = grossSales(records.sales.filter(s => s.tenant === name));
    const share = Number((BigInt(gross) * BigInt(bps) + 5000n) / 10000n);
    return { name, gross, share, net: gross - share };
  });
}
export function snapshot(db, u, id) {
  const isCeo = u.role === "ceo",
    e = scope(db, u, id),
    eid = e?.id || 0,
    rows = records(db, eid);
  const sync = db
    .prepare(
      "SELECT kind,file,revision,done,last,error FROM sync WHERE eid=? AND (kind='ops' OR ?)",
    )
    .all(eid, Number(isCeo))
    .map((s) => ({
      ...s,
      status:
        !s.file || !process.env.GOOGLE_APPLICATION_CREDENTIALS
          ? "Belum terhubung"
          : s.error
            ? "Gagal"
            : s.done < s.revision
              ? "Menunggu"
              : "Tersinkron",
    }));
  const events = db.prepare(
    "SELECT id,name,current FROM events ORDER BY current DESC,id DESC",
  ).all();
  const audits = db
    .prepare(
      "SELECT a.subject,a.action,a.reason,a.before,a.after,a.time,u.name actor FROM audit a JOIN users u ON u.id=a.actor WHERE a.eid=? AND (a.action IN ('edit','cancel') OR ?) ORDER BY a.id DESC",
    )
    .all(eid, Number(isCeo));
  return {
    user: u,
    events,
    event: e && {
      id: eid,
      name: e.name,
      start: e.start,
      finish: e.finish,
      mode: e.mode,
      current: e.current,
      active: active(e),
    },
    ...rows,
    audits,
    sync,
    today: day(now()),
    refreshed: now(),
    ...(isCeo
      ? {
          admin: {
            users: db
              .prepare(
                "SELECT id,name,role,enabled,coalesce(email,'') email FROM users LEFT JOIN emails ON uid=id ORDER BY name",
              )
              .all(),
            tenantStaff: db.prepare("SELECT ts.tenant,ts.uid FROM tenant_staff ts JOIN users u ON u.id=ts.uid WHERE ts.eid=? AND u.enabled=1").all(eid),
            bps: e?.bps || 0,
            sharing: e ? sharing(rows, e.bps) : [],
          },
        }
      : {}),
  };
}
function details(db, e, p, old) {
  check(
    typeof p.tenant === "string" &&
      db
        .prepare(
          "SELECT 1 FROM tenants WHERE eid=? AND name=? AND (enabled=1 OR name=?)",
        )
        .get(e.id, p.tenant, old || ""),
    "Pilih tenant aktif.",
  );
  check(
    Number.isSafeInteger(p.amount) && p.amount > 0 && p.amount <= 999999999999,
    "Nominal tidak valid.",
  );
  check(["QRIS", "Cash"].includes(p.method), "Metode tidak valid.");
}
export function mutate(db, u, p) {
  const isCeo = u.role === "ceo",
    a = p.action;
  if (
    [
      "account",
      "staff",
      "event",
      "rename",
      "current",
      "mode",
      "tenantStaff",
      "tenant",
      "destination",
      "share",
      "recover",
    ].includes(a)
  )
    check(isCeo, "Akses CEO diperlukan.", 403);
  if (a === "account") {
    const name = username(p.name);
    const role = p.role === undefined ? "cashier" : p.role === "developer" ? "ceo" : p.role;
    check(["cashier", "ceo"].includes(role), "Role tidak valid.");
    check(
      !db.prepare("SELECT 1 FROM users WHERE name=?").get(name),
      "Username sudah digunakan.",
    );
    db.prepare("INSERT INTO users(name,hash,role) VALUES(?,?,?)").run(
      name,
      hash(p.password),
      role,
    );
    return;
  }
  if (a === "staff") {
    const staff = db
      .prepare("SELECT * FROM users WHERE id=?")
      .get(p.uid);
    check(staff);
    check(staff.id !== u.id || p.enabled === true, "Akun sendiri harus tetap aktif.");
    if (p.email !== undefined) {
      check(
        typeof p.email === "string" &&
          p.email.length <= 254 &&
          (!p.email || /^[^@ ]+@[^@ ]+\.[^@ ]+$/.test(p.email)),
        "Email tidak valid.",
      );
      db.prepare("INSERT OR REPLACE INTO emails VALUES(?,?)").run(
        p.uid,
        p.email.trim().toLowerCase(),
      );
    }
    if (p.password)
      db.prepare("UPDATE users SET hash=? WHERE id=?").run(
        hash(p.password),
        p.uid,
      );
    check(typeof p.enabled === "boolean");
    if (!p.enabled)
      check(
        !db
          .prepare("SELECT 1 FROM sessions WHERE uid=? AND end IS NULL")
          .get(p.uid),
        "Akhiri sesi kasir lebih dulu.",
      );
    db.prepare("UPDATE users SET enabled=? WHERE id=?").run(+p.enabled, p.uid);
    if (p.password || !p.enabled)
      db.prepare("DELETE FROM tokens WHERE uid=?").run(p.uid);
    return;
  }
  if (a === "event") {
    const id = Number(
      db
        .prepare(
          "INSERT INTO events(name,mode,current) VALUES(?,'off',(SELECT count(*)=0 FROM events))",
        )
        .run(clean(p.name)).lastInsertRowid,
    );
    const input = p.tenantNames ?? "";
    check(typeof input === "string", "Daftar tenant tidak valid.");
    const seen = new Set();
    const insert = db.prepare(
      "INSERT INTO tenants(eid,name,enabled) VALUES(?,?,1)",
    );
    for (const line of input.split("\n")) {
      if (!line.trim()) continue;
      const name = clean(line);
      const key = name.toLocaleLowerCase("id-ID");
      if (!seen.has(key)) insert.run(id, name);
      seen.add(key);
    }
    dirty(db, id);
    return id;
  }
  const e = scope(db, u, p.eid);
  check(e && e.id === p.eid, "Event tidak tersedia.", 403);
  const id = e.id;
  const session = db
    .prepare("SELECT * FROM sessions WHERE eid=? AND end IS NULL AND uid=?")
    .get(id, u.id);
  if (a === "start") {
    check(
      active(e) && !session,
      "Event tidak aktif atau sesi kasirmu sudah berjalan.",
      409,
    );
    db.prepare("INSERT INTO sessions(eid,uid,start) VALUES(?,?,?)").run(
      id,
      u.id,
      now(),
    );
  } else if (a === "end" || a === "recover") {
    const target = db.prepare("SELECT * FROM sessions WHERE eid=? AND id=? AND end IS NULL").get(id,p.sid);
    check(
      target && (a === "recover" || target.uid === u.id),
      "Sesi tidak sesuai.",
      409,
    );
    db.prepare("UPDATE sessions SET end=? WHERE id=?").run(now(), target.id);
    if (a === "recover")
      audit(db, id, u.id, target.id, a, clean(p.reason, 500), target, {
        end: now(),
      });
  } else if (a === "sale") {
    check(typeof p.id === "string" && /^[0-9a-f-]{36}$/i.test(p.id));
    const identity = [
      u.id,
      id,
      p.sid,
      p.tenant,
      p.amount,
      p.method,
    ];
    if (p.proofId) identity.push(p.proofId);
    const original = JSON.stringify(identity);
    const old = db.prepare("SELECT original FROM sales WHERE id=?").get(p.id);
    if (old) {
      check(old.original === original, "Kunci transaksi sudah digunakan.", 409);
      return;
    }
    check(active(e), "Pembayaran memerlukan event aktif.", 409);
    if (p.sid != null) {
      check(session && session.uid === u.id && session.id === p.sid, "Sesi tidak sesuai.", 409);
    }
    details(db, e, p);
    if (p.proofId) check(
      typeof p.proofId === "string" && db.prepare("SELECT 1 FROM proofs WHERE id=? AND eid=? AND uid=? AND sale_id IS NULL").get(p.proofId,id,u.id),
      "Foto bukti tidak tersedia. Lampirkan ulang foto.",
    );
    const time = now();
    // Historical receipts and exports identify their cashier through this relation.
    const cashierRecord = p.sid ?? db.prepare(
      "SELECT id FROM sessions WHERE eid=? AND uid=? ORDER BY id DESC LIMIT 1"
    ).get(id, u.id)?.id ?? db.prepare(
      "INSERT INTO sessions(eid,uid,start,end) VALUES(?,?,?,?)"
    ).run(id, u.id, time, time).lastInsertRowid;
    db.prepare(
      "INSERT INTO sales(id,eid,sid,tenant,amount,method,created,updated,status,original) VALUES(?,?,?,?,?,?,?,?,'paid',?)",
    ).run(p.id, id, cashierRecord, p.tenant, p.amount, p.method, time, time, original);
    if (p.proofId) db.prepare("UPDATE proofs SET sale_id=? WHERE id=?").run(p.id,p.proofId);
  } else if (a === "edit" || a === "cancel") {
    const original = db
      .prepare(
        "SELECT tenant,amount,method,status,version,created FROM sales WHERE eid=? AND id=?",
      )
      .get(id, p.id);
    check(
      original && original.status === "paid" && original.version === p.version,
      "Transaksi sudah berubah. Buka kembali.",
      409,
    );
    check(
      isCeo || day(original.created) === day(now()),
      "Batas koreksi hari ini sudah lewat.",
      403,
    );
    const reason = clean(p.reason, 500);
    if (a === "edit") details(db, e, p, original.tenant);
    const changed =
      a === "edit"
        ? {
            tenant: p.tenant,
            amount: p.amount,
            method: p.method,
            status: "paid",
          }
        : { ...original, status: "cancelled" };
    db.prepare(
      "UPDATE sales SET tenant=?,amount=?,method=?,status=?,updated=?,version=version+1 WHERE id=?",
    ).run(
      changed.tenant,
      changed.amount,
      changed.method,
      changed.status,
      now(),
      p.id,
    );
    audit(db, id, u.id, p.id, a, reason, original, {
      ...original,
      ...changed,
      version: original.version + 1,
    });
  } else if (a === "rename")
    db.prepare("UPDATE events SET name=? WHERE id=?").run(clean(p.name), id);
  else if (a === "mode") {
    check(["on", "off"].includes(p.mode));
    if (p.mode === "off") db.prepare("UPDATE sessions SET end=? WHERE eid=? AND end IS NULL").run(now(), id);
    db.prepare("UPDATE events SET mode=? WHERE id=?").run(p.mode, id);
  } else if (a === "current") {
    check(
      !db
        .prepare("SELECT id FROM sessions WHERE eid!=? AND end IS NULL")
        .get(id),
      "Akhiri sesi event sebelumnya.",
    );
    db.exec("UPDATE events SET current=0");
    db.prepare("UPDATE events SET current=1 WHERE id=?").run(id);
  } else if (a === "tenant") {
    const input = clean(p.name);
    const key = input.toLocaleLowerCase("id-ID");
    const matches = db
      .prepare("SELECT name FROM tenants WHERE eid=?")
      .all(id)
      .filter((t) => t.name.toLocaleLowerCase("id-ID") === key);
    const name =
      matches.find((t) => t.name === input)?.name || matches[0]?.name || input;
    check(typeof p.enabled === "boolean");
    db.prepare(
      "INSERT INTO tenants(eid,name,enabled) VALUES(?,?,?) ON CONFLICT(eid,name) DO UPDATE SET enabled=excluded.enabled",
    ).run(id, name, +p.enabled);
  } else if (a === "tenantStaff") {
    check(typeof p.enabled === "boolean");
    check(db.prepare("SELECT 1 FROM users WHERE id=? AND enabled=1 AND role='cashier'").get(p.uid), "Pilih akun kasir aktif.");
    check(db.prepare("SELECT 1 FROM tenants WHERE eid=? AND name=?").get(id,p.tenant), "Tenant tidak ditemukan.");
    if (p.enabled) db.prepare("INSERT OR IGNORE INTO assignments(eid,uid) VALUES(?,?)").run(id,p.uid);
    const sql = p.enabled ? "INSERT OR IGNORE INTO tenant_staff(eid,tenant,uid) VALUES(?,?,?)" : "DELETE FROM tenant_staff WHERE eid=? AND tenant=? AND uid=?";
    db.prepare(sql).run(id,p.tenant,p.uid);
  } else if (a === "share") {
    check(
      Number.isInteger(p.bps) && p.bps >= 0 && p.bps <= 10000,
      "Persentase harus 0–100.",
    );
    db.prepare("UPDATE events SET bps=? WHERE id=?").run(p.bps, id);
    audit(
      db,
      id,
      u.id,
      "sharing",
      a,
      "Persentase event",
      { bps: e.bps },
      { bps: p.bps },
    );
    dirty(db, id, ["private"]);
    return;
  } else if (a === "destination") {
    check(
      ["ops", "private"].includes(p.kind) &&
        typeof p.file === "string" &&
        /^[A-Za-z0-9_-]{15,150}$/.test(p.file),
      "Masukkan ID spreadsheet.",
    );
    const existing = db
      .prepare("SELECT * FROM report_files WHERE file=?")
      .get(p.file);
    check(
      !existing || (existing.eid === id && existing.kind === p.kind),
      "Setiap laporan memerlukan file tersendiri.",
    );
    db.prepare("INSERT OR IGNORE INTO report_files VALUES(?,?,?)").run(
      p.file,
      id,
      p.kind,
    );
    const prior = db
      .prepare("SELECT file,last FROM sync WHERE eid=? AND kind=?")
      .get(id, p.kind);
    check(
      !prior?.last || prior.file === p.file,
      "Tujuan sudah terikat. Gunakan file khusus per event.",
    );
    db.prepare(
      "UPDATE sync SET file=?,next=0,error=NULL WHERE eid=? AND kind=?",
    ).run(p.file, id, p.kind);
    dirty(db, id, [p.kind]);
    return;
  } else check(false, "Tindakan tidak dikenal.");
  dirty(db, id);
}
