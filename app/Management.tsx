"use client";
import { useState } from "react";
import { rupiah, type State } from "./model";
type Props = {
  s: State;
  run: (data: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
};
function Form({ title, children, submit, button = "Simpan", busy = false }) {
  return (
    <form
      className="editor"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const password = form.querySelector<HTMLInputElement>(
          'input[type="password"]',
        );
        const previous = password?.value;
        if (
          (await submit(Object.fromEntries(new FormData(form)))) &&
          password &&
          password.value === previous
        )
          password.value = "";
      }}
    >
      <h3>{title}</h3>
      {children}
      <button disabled={busy}>{button}</button>
    </form>
  );
}
function Field({
  label,
  name,
  type = "text",
  value = "",
  required = true,
  ...props
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        {...props}
      />
    </label>
  );
}
const wib = (s: string) =>
  s ? new Date(Date.parse(s) + 7 * 3600000).toISOString().slice(0, 16) : "";
export function Management({ s, run, busy }: Props) {
  const e = s.event,
    admin = s.admin;
  if (!admin) return null;
  const setup = (title, event) => (
    <Form
      title={title}
      busy={busy}
      submit={(p) => run({ ...p, action: event ? "rename" : "event" })}
    >
      <Field label="Nama event" name="name" value={event?.name} />
      {!event && (
        <label>
          Tenant (opsional)
          <textarea
            name="tenantNames"
            rows={4}
            aria-describedby="tenant-help"
          />
          <small id="tenant-help">Tulis satu nama tenant per baris.</small>
        </label>
      )}
    </Form>
  );
  return (
    <section className="management-groups">
      <div className="panel stack settings-list">
      <details open={!e}>
        <summary>Buat event</summary>
        {setup("Event baru", null)}
      </details>
      </div>
      {e && (
        <div className="panel stack settings-list">
          <details>
            <summary>Pengaturan event</summary>
            {setup("Ubah nama event", e)}
            <hr />
            {e.current && (
              <button disabled={busy} onClick={() => run({ action: "mode", mode: e.active ? "off" : "on" })}>
                {e.active ? "Akhiri event" : "Aktifkan event"}
              </button>
            )}
            {!e.current && (
              <button
                disabled={busy}
                onClick={() => run({ action: "current" })}
              >
                Jadikan event utama
              </button>
            )}
          </details>
          <details>
            <summary>Tenant dan penugasan kasir</summary>
            <Form
              title="Tambah tenant"
              busy={busy}
              submit={(p) => run({ ...p, action: "tenant", enabled: true })}
            >
              <Field name="name" label="Nama tenant" />
            </Form>
            {s.tenants.map((t) => (
              <article key={t.name}>
                {t.name}
                <button
                  disabled={busy}
                  onClick={() =>
                    run({ action: "tenant", name: t.name, enabled: !t.enabled })
                  }
                >
                  {t.enabled ? "Nonaktifkan" : "Aktifkan"}
                </button>
              </article>
            ))}
            {s.tenants.some((t, i, all) =>
              all.some(
                (other, j) =>
                  j < i &&
                  other.name.toLocaleLowerCase("id-ID") ===
                    t.name.toLocaleLowerCase("id-ID"),
              ),
            ) && (
              <p role="alert">
                Ada nama tenant yang hanya berbeda huruf besar/kecil. Periksa
                riwayat masing-masing sebelum menonaktifkan salah satunya.
              </p>
            )}
            <h3>Kasir event</h3>
            {admin.users.filter((u) => u.role === "cashier").map((u) => (
              <article key={u.id}>
                {u.name}
                <button
                  disabled={busy}
                  onClick={() =>
                    run({
                      action: "assign",
                      uid: u.id,
                      enabled: !admin.assigned.includes(u.id),
                    })
                  }
                >
                  {admin.assigned.includes(u.id)
                    ? "Lepas penugasan"
                    : "Tugaskan"}
                </button>
              </article>
            ))}
          </details>
          <details>
            <summary>Bagi hasil developer</summary>
            <Form
              title="Persentase Nyaris"
              busy={busy}
              submit={(p) =>
                run({
                  action: "share",
                  bps: Math.round(Number(p.percent) * 100),
                })
              }
            >
              <Field
                label="Persentase (%)"
                name="percent"
                type="number"
                min={0}
                max={100}
                step=".01"
                value={String(admin.bps / 100)}
              />
            </Form>
            <div className="scroll">
              <table className="report">
                <thead>
                  <tr>
                    {["Tenant", "Bruto", "Nyaris", "Net tenant"].map((t) => (
                      <th key={t}>{t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {admin.sharing.map((t) => (
                    <tr key={t.name}>
                      {[
                        t.name,
                        rupiah(t.gross),
                        rupiah(t.share),
                        rupiah(t.net),
                      ].map((v, i) => (
                        <td key={i}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {s.audits
              .filter((a) => a.action === "share")
              .map((a, i) => (
                <p key={i}>
                  {a.actor} · {new Date(a.time).toLocaleString("id-ID")} ·{" "}
                  {JSON.parse(a.before).bps / 100}% →{" "}
                  {JSON.parse(a.after).bps / 100}%
                </p>
              ))}
          </details>
          <details>
            <summary>Google Sheets</summary>
            <p>
              Siapkan dua file khusus event. Bagikan akses editor kepada service
              account. Akses kasir hanya pada file operasional.
            </p>
            {s.sync.map((j) => (
              <Form
                key={j.kind}
                title={
                  j.kind === "ops"
                    ? "Laporan operasional"
                    : "Laporan bagi hasil privat"
                }
                busy={busy || !!j.last}
                button={j.last ? "Tujuan terikat" : "Hubungkan tujuan"}
                submit={(p) =>
                  run({ ...p, action: "destination", kind: j.kind })
                }
              >
                <Field
                  name="file"
                  label="ID spreadsheet"
                  value={j.file || ""}
                  readOnly={!!j.last}
                />
                <p>
                  {j.status} · {j.last || "Belum pernah sinkron"} {j.error}
                </p>
              </Form>
            ))}
          </details>
        </div>
      )}
    </section>
  );
}
export function History({ s, run, busy }: Props) {
  const [filter, F] = useState({
    tenant: "",
    cashier: "",
    method: "",
    status: "",
  });
  const rows = s.sales.filter((v) =>
    Object.entries(filter).every(([k, w]) => !w || v[k] === w),
  );
  return (
    <section className="panel stack">
      <div className="transaction-filters">
        {Object.entries({
          tenant: s.tenants.map((t) => t.name),
          cashier: [...new Set(s.sessions.map((v) => v.cashier))],
          method: ["QRIS", "Cash"],
          status: ["paid", "cancelled"],
        }).map(([k, values]) => (
          <label key={k}>
            {
              {
                tenant: "Tenant",
                cashier: "Kasir",
                method: "Metode",
                status: "Status",
              }[k]
            }
            <select
              value={filter[k]}
              onChange={(e) => F({ ...filter, [k]: e.target.value })}
            >
              <option value="">Semua</option>
              {values.map((v) => (
                <option key={v} value={v}>
                  {v === "paid"
                    ? "Lunas"
                    : v === "cancelled"
                      ? "Dibatalkan"
                      : v}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {!rows.length && <p>Belum ada transaksi yang sesuai.</p>}
      {rows.map((v) => {
        const identity =
          wib(v.created).replace("T", " ") + " WIB · #" + v.id.slice(0, 8);
        const allowed =
          v.status === "paid" &&
          (s.admin || wib(v.created).slice(0, 10) === s.today);
        return (
          <details key={v.id}>
            <summary>
              {v.tenant} · {rupiah(v.amount)} · {v.method} ·{" "}
              {v.status === "paid" ? "Lunas" : "Dibatalkan"}
              <small>{identity}</small>
            </summary>
            <p>
              {wib(v.created).replace("T", " ")} WIB · {v.cashier} · Sesi{" "}
              {v.sid}
            </p>
            <small>ID {v.id}</small>
            {allowed && (
              <div key={v.version}>
                <details>
                  <summary>Edit transaksi</summary>
                  <Form
                    title="Koreksi pembayaran"
                    busy={busy}
                    submit={(p) =>
                      run({
                        ...p,
                        action: "edit",
                        id: v.id,
                        version: v.version,
                        amount: Number(p.amount),
                      })
                    }
                  >
                    <label>
                      Tenant
                      <select name="tenant" defaultValue={v.tenant}>
                        {s.tenants
                          .filter((t) => t.enabled || t.name === v.tenant)
                          .map((t) => (
                            <option key={t.name}>{t.name}</option>
                          ))}
                      </select>
                    </label>
                    <Field
                      label="Nominal (Rp)"
                      type="number"
                      min={1}
                      name="amount"
                      value={String(v.amount)}
                    />
                    <label>
                      Metode
                      <select name="method" defaultValue={v.method}>
                        <option>QRIS</option>
                        <option>Cash</option>
                      </select>
                    </label>
                    <Field label="Alasan koreksi" name="reason" />
                  </Form>
                </details>
                <details>
                  <summary>Batalkan transaksi</summary>
                  <Form
                    title={
                      v.tenant + " · " + rupiah(v.amount) + " · " + identity
                    }
                    busy={busy}
                    button="Konfirmasi pembatalan"
                    submit={(p) =>
                      run({
                        ...p,
                        action: "cancel",
                        id: v.id,
                        version: v.version,
                      })
                    }
                  >
                    <p>Pengembalian dana dilakukan manual.</p>
                    <Field label="Alasan pembatalan" name="reason" />
                  </Form>
                </details>
              </div>
            )}
            <h3>Riwayat perubahan</h3>
            {!s.audits.some((a) => a.subject === v.id) && (
              <p>Belum ada perubahan.</p>
            )}
            {s.audits
              .filter((a) => a.subject === v.id)
              .map((a, i) => (
                <article key={i}>
                  <div>
                    <b>
                      {a.actor} ·{" "}
                      {a.action === "edit" ? "Koreksi" : "Pembatalan"}
                    </b>
                    <p>
                      {wib(a.time).replace("T", " ")} WIB · {a.reason}
                    </p>
                    {[a.before, a.after].map((raw, j) => {
                      const x = JSON.parse(raw);
                      return (
                        <small key={j}>
                          {j ? "Sesudah" : "Sebelum"} · {x.tenant} ·{" "}
                          {rupiah(x.amount)} · {x.method} · {x.status}
                        </small>
                      );
                    })}
                  </div>
                </article>
              ))}
          </details>
        );
      })}
    </section>
  );
}
export function Reports({ s }: { s: State }) {
  const paid = s.sales.filter((v) => v.status === "paid");
  function summary(rows: State["sales"]) {
    return (
      rupiah(rows.reduce((n, v) => n + v.amount, 0)) +
      " · " +
      rows.length +
      " transaksi"
    );
  }
  return (
    <section className="panel stack">
      <h3>Penjualan bruto</h3>
      <h2>{summary(paid)}</h2>
      {["QRIS", "Cash"].map((m) => (
        <article key={m}>
          {m} tercatat<b>{summary(paid.filter((v) => v.method === m))}</b>
        </article>
      ))}
      <h3>Penjualan tenant</h3>
      {s.tenants.map((t) => (
        <article key={t.name}>
          {t.name}
          <b>{summary(paid.filter((v) => v.tenant === t.name))}</b>
        </article>
      ))}
      <h3>Aktivitas kasir</h3>
      {[...new Set(s.sessions.map((v) => v.cashier))].map((n) => (
        <article key={n}>
          {n}
          <b>{summary(paid.filter((v) => v.cashier === n))}</b>
        </article>
      ))}
      <p>Diperbarui {wib(s.refreshed).replace("T", " ")} WIB</p>
      {s.sync.map((j) => (
        <p key={j.kind}>
          Sheets {j.kind === "ops" ? "operasional" : "privat"} · {j.status} ·
          Sinkron terakhir {j.last ? wib(j.last) + " WIB" : "Belum ada"}{" "}
          {j.file && (
            <a href={"https://docs.google.com/spreadsheets/d/" + j.file}>
              Buka file
            </a>
          )}
        </p>
      ))}
    </section>
  );
}

export function AccountManagement({ s, run, busy }: Props) {
  const admin = s.admin;
  if (!admin) return null;
  return (
    <section className="panel stack account-management">
        <Form
          title="Buat akun"
          busy={busy}
          submit={(p) => run({ ...p, action: "account" })}
        >
          <Field label="Username" name="name" />
          <label>Role
            <select name="role" defaultValue="cashier">
              <option value="cashier">Kasir</option>
              <option value="developer">Developer</option>
            </select>
          </label>
          <Field
            label="Kata sandi awal (minimal 12 karakter)"
            name="password"
            type="password"
            minLength={12}
            autoComplete="new-password"
          />
        </Form>
        {admin.users.map((u) => (
          <details key={u.id}>
            <summary>
              {u.name} · {u.role === "developer" ? "Developer" : "Kasir"} · {u.enabled ? "Aktif" : "Nonaktif"}
            </summary>
            <Form
              title="Pengaturan akun"
              busy={busy}
              submit={(p) =>
                run({
                  ...p,
                  uid: u.id,
                  action: "staff",
                  enabled: p.enabled === "1",
                })
              }
            >
              <label>
                Status
                <select name="enabled" defaultValue={u.enabled}>
                  <option value="1">Aktif</option>
                  <option value="0" disabled={u.id === s.user.id}>Nonaktif</option>
                </select>
              </label>
              <Field
                label="Email Google untuk akses laporan operasional"
                name="email"
                value={u.email}
                type="email"
                required={false}
              />
              <Field
                label="Kata sandi baru (opsional)"
                name="password"
                type="password"
                minLength={12}
                required={false}
              />
            </Form>
          </details>
        ))}
    </section>
  );
}
