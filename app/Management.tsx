"use client";
import { useRef, useState } from "react";
import { grossSales } from "../lib/sales.mjs";
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
      {title && <h3>{title}</h3>}
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
  const [creating, setCreating] = useState(false);
  const e = s.event,
    admin = s.admin;
  if (!admin) return null;
  const setup = (title, event) => (
    <Form
      title={title}
      button={event ? "Simpan nama" : "Simpan"}
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

      {e && (
        <div className="panel stack settings-list">
          <section className="event-settings" key={e.id}>
            <div className="event-controls">
              <h3>{e.name} · {e.active ? "Aktif" : "Nonaktif"}</h3>
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
            </div>
            {setup("", e)}
          </section>
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
                <div><strong>{t.name}</strong>
                  <small>{admin.tenantStaff.filter(a => a.tenant === t.name).map(a => admin.users.find(u => u.id === a.uid)?.name).join(", ") || "Belum ada kasir"}</small>
                  <details><summary>Atur kasir tenant</summary>
                    {admin.users.filter(u => u.enabled && u.role === "cashier").map(u => <label key={u.id}>
                      <input type="checkbox" disabled={busy} checked={admin.tenantStaff.some(a => a.tenant === t.name && a.uid === u.id)}
                        onChange={event => run({action:"tenantStaff", tenant:t.name, uid:u.id, enabled:event.target.checked})} /> {u.name}
                    </label>)}
                    {!admin.users.some(u => u.enabled && u.role === "cashier") && <p>Belum ada akun kasir aktif.</p>}
                  </details>
                </div>
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
      {e && <button aria-expanded={creating} onClick={() => setCreating(!creating)}>{creating ? "Tutup form" : "+ Buat event"}</button>}
      {(!e || creating) && <div className="panel stack">{setup("Buat event", null)}</div>}
    </section>
  );
}
function FilterChoice({ label, values, value, onChange, open, setOpen }: {
  open: boolean; setOpen: (open: boolean) => void; label: string; values: string[]; value: string; onChange: (value: string) => void;
}) {

  const trigger = useRef<HTMLButtonElement>(null);
  const display = (v: string) => label === "Status" && v === "paid" ? "Lunas" :
    label === "Status" && v === "cancelled" ? "Dibatalkan" : v || "Semua";
  return <div className="filter-choice"
    onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}
    onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } }}>
    <span>{label}</span>
    <button type="button" ref={trigger} aria-label={label + ", " + display(value)}
      aria-expanded={open} onClick={() => setOpen(!open)}>{display(value)}</button>
    {open && <div className="filter-options" role="group" aria-label={label}>
      {["", ...values].map(v => <button type="button" key={v} aria-pressed={v === value}
        onClick={() => { onChange(v); setOpen(false); trigger.current?.focus(); }}>{display(v)}</button>)}
    </div>}
  </div>;
}
export function History({ s, run, busy }: Props) {
  const [menu, setMenu] = useState("");
  const [showFilters, setShowFilters] = useState(false);
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
      <button className="mobile-filter" aria-expanded={showFilters} onClick={() => { setShowFilters(!showFilters); setMenu(""); }}>Filter</button>
      <div className="transaction-filters" data-visible={showFilters}>
        {Object.entries({
          tenant: s.tenants.map((t) => t.name),
          cashier: [...new Set(s.sessions.map((v) => v.cashier))],
          method: ["QRIS", "Cash"],
          status: ["paid", "cancelled"],
        }).map(([k, values]) => (
          <FilterChoice key={k} label={{tenant:"Tenant", cashier:"Kasir", method:"Metode", status:"Status"}[k]}
            open={menu === k} setOpen={(open) => setMenu(current => open ? k : current === k ? "" : current)} values={values} value={filter[k]} onChange={(value) => F({ ...filter, [k]: value })} />

        ))}
      </div>
      {Object.values(filter).some(Boolean) && <button onClick={() => { F({ tenant:"", cashier:"", method:"", status:"" }); setMenu(""); }}>Hapus filter</button>}
      {!rows.length && <p>{s.sales.length ? "Tidak ada transaksi yang cocok." : "Belum ada transaksi."}</p>}
      {rows.map((v) => {
        const identity =
          wib(v.created).replace("T", " ") + " WIB · #" + v.id.slice(0, 8);
        const allowed =
          v.status === "paid" &&
          (s.admin || wib(v.created).slice(0, 10) === s.today);
        return (
          <details key={v.id}>
            <summary>
              <strong>{rupiah(v.amount)} · {v.tenant}</strong> ·{" "}
              {v.status === "paid" ? "Lunas" : "Dibatalkan"}
              <small>{v.cashier} · {v.method} · {identity}</small>
            </summary>
            <p>
              {wib(v.created).replace("T", " ")} WIB · {v.cashier}
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
  const ranked = s.tenants.map(t => ({name:t.name, gross:grossSales(paid.filter(v => v.tenant === t.name))})).sort((a,b) => b.gross-a.gross);
  function summary(rows: State["sales"]) {
    return (
      rupiah(grossSales(rows)) +
      " · " +
      rows.length +
      " transaksi"
    );
  }
  return (
    <section className="panel stack">
      <h3>Penjualan bruto</h3>
      <h2>{rupiah(grossSales(paid))}</h2><p>{paid.length} transaksi</p>
      {["QRIS", "Cash"].map((m) => (
        <article key={m}>
          {m} tercatat<b>{summary(paid.filter((v) => v.method === m))}</b>
        </article>
      ))}
      <h3>Penjualan tenant</h3>
      {ranked.map(t => (
        <article key={t.name}>
          <span>{t.name}</span><meter aria-label={"Penjualan " + t.name} min={0} max={ranked[0].gross || 1} value={t.gross} />
          <b>{rupiah(t.gross)}</b>
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
  const [editing, setEditing] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const u = admin?.users.find(user => user.id === editing);
  if (!admin) return null;
  return (
    <div className="account-management">
      <section className="panel stack">
        <div className="account-heading"><h3>Daftar akun</h3><button className="primary" aria-expanded={creating} onClick={() => setCreating(!creating)}>{creating ? "Tutup form" : "+ Buat akun"}</button></div>
        {creating && <section className="panel stack">
        <Form
          title="Buat akun"
          busy={busy}
          submit={async (p) => { const ok = await run({ ...p, action: "account" }); if (ok) setCreating(false); return ok; }}
        >
          <Field label="Username" name="name" />
          <fieldset className="role-field"><legend>Role</legend>
            <div>{["cashier", "developer"].map((role) => <label key={role}>
              <input type="radio" name="role" value={role} defaultChecked={role === "cashier"} />
              <span>{role === "cashier" ? "Kasir" : "Developer"}</span>
            </label>)}</div>
          </fieldset>
          <Field
            label="Kata sandi awal (minimal 8 karakter)"
            name="password"
            type="password"
            minLength={8}
            autoComplete="new-password"
          />
        </Form>
      </section>}
        <div className="scroll"><table className="report"><thead><tr>
          <th>Username</th><th>Role</th><th>Status</th><th>Aksi</th>
        </tr></thead><tbody>{admin.users.map(user => <tr key={user.id}>
          <th scope="row">{user.name}</th><td>{user.role === "cashier" ? "Kasir" : "Developer"}</td>
          <td>{user.enabled ? "Aktif" : "Nonaktif"}</td>
          <td><button aria-label={`Edit akun ${user.name}`} aria-expanded={editing === user.id}
            onClick={() => setEditing(editing === user.id ? null : user.id)}>{editing === user.id ? "Tutup" : "Edit"}</button></td>
        </tr>)}</tbody></table></div>
        {u && (
            <Form
              key={u.id}
              title={`Edit akun ${u.name}`}
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
                minLength={8}
                required={false}
              />
            </Form>
        )}
      </section>
    </div>
  );
}
