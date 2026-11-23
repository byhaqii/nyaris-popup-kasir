import { grossSales } from "./sales.mjs";
import { openShared } from "./shared.mjs";
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { atomic } from "./store.mjs";
import { records, sharing } from "./pos.mjs";
async function request(url, options) {
  const r = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw Error("Google HTTP " + r.status);
  return r.json();
}
const b64 = (s) => Buffer.from(JSON.stringify(s)).toString("base64url");
async function authorize(key) {
  const time = Math.floor(Date.now() / 1000),
    endpoint = "https://oauth2.googleapis.com/token";
  const payload =
    b64({ alg: "RS256", typ: "JWT" }) +
    "." +
    b64({
      iss: key.client_email,
      scope:
        "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly",
      aud: endpoint,
      iat: time,
      exp: time + 3600,
    });
  const jwt =
    payload +
    "." +
    createSign("RSA-SHA256").update(payload).sign(key.private_key, "base64url");
  return (
    await request(endpoint, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    })
  ).access_token;
}
export function tables(data, kind, bps) {
  if (kind === "private")
    return {
      "Bagi Hasil": [
        [
          "Tenant",
          "Persentase (%)",
          "Bruto (Rp)",
          "Nyaris (Rp)",
          "Net tenant (Rp)",
        ],
        ...sharing(data, bps).map((t) => [
          t.name,
          bps / 100,
          t.gross,
          t.share,
          t.net,
        ]),
      ],
    };
  const paid = data.sales.filter((s) => s.status === "paid");
  const total = (rows, method) =>
    grossSales(rows.filter(r => !method || r.method === method));
  const sales = [...data.sales].reverse();
  return {
    Transaksi: [
      [
        "ID",
        "Waktu (UTC)",
        "Tenant",
        "Nominal (Rp)",
        "Metode",
        "Kasir",
        "Sesi",
        "Status",
        "Diperbarui (UTC)",
      ],
      ...sales.map((s) => [
        s.id,
        s.created,
        s.tenant,
        s.amount,
        s.method,
        s.cashier,
        s.sid,
        s.status,
        s.updated,
      ]),
    ],
    Tenant: [
      ["Tenant", "Transaksi lunas", "Bruto (Rp)"],
      ...data.tenants.map((t) => {
        const rows = paid.filter((s) => s.tenant === t.name);
        return [t.name, rows.length, total(rows)];
      }),
    ],
    Sesi: [
      [
        "Sesi",
        "Kasir",
        "Mulai (UTC)",
        "Akhir (UTC)",
        "Durasi selesai (menit)",
        "Lunas",
        "Cash (Rp)",
        "QRIS (Rp)",
        "Bruto (Rp)",
      ],
      ...data.sessions.map((s) => {
        const rows = paid.filter((r) => r.sid === s.id);
        return [
          s.id,
          s.cashier,
          s.start,
          s.end || "",
          s.end
            ? Math.floor((Date.parse(s.end) - Date.parse(s.start)) / 60000)
            : "",
          rows.length,
          total(rows, "Cash"),
          total(rows, "QRIS"),
          total(rows),
        ];
      }),
    ],
  };
}
export async function deliver(db, job) {
  const key = JSON.parse(
    readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"),
  );
  const owner = process.env.POS_GOOGLE_OWNER?.toLowerCase();
  if (!owner) throw Error("Email pemilik belum dikonfigurasi.");
  const token = await authorize(key),
    headers = {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    };
  const metadata = await request(
    "https://www.googleapis.com/drive/v3/files/" +
      job.file +
      "?fields=owners(emailAddress),permissions(type,emailAddress,role),shared,driveId",
    { headers },
  );
  if (
    !metadata.owners?.some((o) => o.emailAddress?.toLowerCase() === owner) ||
    !metadata.permissions?.length ||
    metadata.driveId
  )
    throw Error("Periksa kepemilikan dan izin file.");
  const allowed = new Set([owner, key.client_email.toLowerCase()]);
  if (job.kind === "ops")
    for (const r of db
      .prepare(
        "SELECT email FROM emails JOIN assignments USING(uid) JOIN users ON users.id=uid WHERE eid=? AND enabled=1",
      )
      .all(job.eid))
      allowed.add(r.email.toLowerCase());
  if (
    metadata.permissions.some(
      (p) => p.type !== "user" || !allowed.has(p.emailAddress?.toLowerCase()),
    )
  )
    throw Error("Akses file melebihi izin event.");
  const base = "https://sheets.googleapis.com/v4/spreadsheets/" + job.file;
  const sheet = await request(
    base + "?fields=sheets(properties(sheetId,title,gridProperties))",
    { headers },
  );
  const snapshot = atomic(db, () =>
    tables(
      records(db, job.eid),
      job.kind,
      db.prepare("SELECT bps FROM events WHERE id=?").get(job.eid).bps,
    ),
  );
  const requests = [];
  let newId = Math.max(0, ...sheet.sheets.map((s) => s.properties.sheetId)) + 1;
  for (const [title, rows] of Object.entries(snapshot)) {
    const old = sheet.sheets.find(
      (s) => s.properties.title === title,
    )?.properties;
    const sheetId = old?.sheetId ?? newId++;
    const gridProperties = {
      rowCount: Math.max(rows.length, old?.gridProperties?.rowCount || 100),
      columnCount: Math.max(
        rows[0].length,
        old?.gridProperties?.columnCount || 15,
      ),
    };
    if (!old)
      requests.push({
        addSheet: { properties: { sheetId, title, gridProperties } },
      });
    else if (gridProperties.rowCount > old.gridProperties.rowCount)
      requests.push({
        updateSheetProperties: {
          properties: { sheetId, gridProperties },
          fields: "gridProperties.rowCount",
        },
      });
    requests.push({
      updateCells: {
        range: {
          sheetId,
          startRowIndex: 0,
          startColumnIndex: 0,
          endColumnIndex: rows[0].length,
        },
        rows: rows.map((row) => ({
          values: row.map((v) => ({
            userEnteredValue:
              typeof v === "number"
                ? { numberValue: v }
                : { stringValue: String(v) },
          })),
        })),
        fields: "userEnteredValue",
      },
    });
  }
  await request(base + ":batchUpdate", {
    method: "POST",
    headers,
    body: JSON.stringify({ requests }),
  });
}
export async function drain(send = deliver) {
  const { db, finish } = await openShared(true);
  try {
    const jobs = db
      .prepare(
        "SELECT * FROM sync WHERE file IS NOT NULL AND done<revision AND next<=? ORDER BY eid,kind",
      )
      .all(Date.now());
    for (const job of jobs) {
      try {
        await send(db, job);
        db.prepare(
          "UPDATE sync SET done=?,last=?,error=NULL,next=0 WHERE eid=? AND kind=? AND file=?",
        ).run(
          job.revision,
          new Date().toISOString(),
          job.eid,
          job.kind,
          job.file,
        );
      } catch (e) {
        db.prepare(
          "UPDATE sync SET error=?,next=? WHERE eid=? AND kind=? AND file=?",
        ).run(
          e.message.startsWith("Google HTTP")
            ? e.message
            : "Periksa kredensial, pemilik dan akses file.",
          Date.now() + 60000,
          job.eid,
          job.kind,
          job.file,
        );
      }
    }
  } finally {
    await finish();
  }
}
