"use client";
import { useEffect, useRef, useState } from "react";
import { pendingPayment, receiptMessage } from "../lib/payment.mjs";
import PasswordChange from "./PasswordChange";
import { Icon } from "./art";
import { AccountManagement, Management, History, Reports } from "./Management";
import { rupiah, type State } from "./model";
const tabs = ["Kasir", "Transaksi", "Ringkasan", "Sesi"];
const accountsTab = "Account Management";
const developerTabs = [...tabs, "Kelola", accountsTab];
const clock = (s: string) =>
  new Date(s).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
export default function Workspace({ initial }: { initial: State }) {
  const [tab, T] = useState("Kasir"),
    [state, S] = useState<State>(initial),
    [tenant, A] = useState(""),
    [amount, B] = useState(""),
    [method, M] = useState("QRIS"),
    [busy, W] = useState(false),
    [err, E] = useState(""),
    [success, U] = useState(""),
    [dialog, D] = useState(""),
    [ready, R] = useState(true);
  const [missing, setMissing] = useState(false);
  const profileDialog = useRef<HTMLDialogElement>(null);
  const pendingKey = "nyaris:payment:" + state.user.id;
  const [pending, setPending] = useState(null);
  const etag = useRef(""),
    confirmation = useRef<{ eid: number; sid: number } | null>(null),
    locked = useRef(false),
    modal = useRef<HTMLDialogElement>(null),
    first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let saved;
    try {
      saved = pendingPayment(localStorage, pendingKey, null);
    } catch {
      E("Tidak dapat membaca status pembayaran di browser ini.");
      return;
    }
    if (saved) {
      setPending(saved);
      A(saved.tenant);
      B(String(saved.amount));
      M(saved.method);
      select(saved.eid);
      D("sale");
    }
  }, [pendingKey]);
  const [draftEvent, setDraftEvent] = useState<number | null>(null);
  const [selected, select] = useState(0),
    [notice, N] = useState(""),
    generation = useRef(0);
  const isDeveloper = !!state.admin;
  const event = state.event,
    tenants = state.tenants.filter((t) => t.enabled).map((t) => t.name);
  useEffect(() => {
    let live = true;
    let inflight = false;
    etag.current = "";
    async function refresh() {
      if (inflight) return;
      inflight = true;
      const seq = generation.current;
      try {
        const r = await fetch(
          "/api/pos" + (selected ? "?event=" + selected : ""),
          {
            cache: "no-store",
            headers: etag.current ? { "If-None-Match": etag.current } : {},
          },
        );
        if (r.status === 401) {
          location.replace("/login");
          return;
        }
        if (r.status === 304) {
          if (live && !locked.current && seq === generation.current) {
            R(true);
            S((v) => ({ ...v, refreshed: new Date().toISOString() }));
          }
          return;
        }
        if (!r.ok) throw Error();
        const data = await r.json();
        if (live && !locked.current && seq === generation.current) {
          etag.current = r.headers.get("etag") || "";
          S(data);
          R(true);
        }
      } catch {
        if (live) R(false);
      } finally {
        inflight = false;
      }
    }
    refresh();
    const id = setInterval(refresh, 2000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [selected]);
  useEffect(() => {
    if (dialog) modal.current?.showModal();
    else modal.current?.close();
  }, [dialog]);
  const session = state.sessions.find((s) => !s.end),
    active = !!session && session.uid === state.user.id,
    amt = Number(amount),
    valid =
      (draftEvent === null || draftEvent === event?.id) &&
      tenants.includes(tenant) &&
      amt > 0 &&
      event?.active &&
      active &&
      ready;
  const sum = (rows: State["sales"]) =>
    rows.filter((r) => r.status === "paid").reduce((a, b) => a + b.amount, 0);
  const reset = () => {
    E("");
  };
  function clearPending(id) {
    if (pendingPayment(localStorage, pendingKey, null)?.id === id)
      localStorage.removeItem(pendingKey);
    setPending(null);
  }
  async function run(
    payload: Record<string, unknown>,
    onSuccess?: (data) => void,
  ) {
    if (locked.current) return false;
    locked.current = true;
    generation.current++;
    W(true);
    E("");
    N("");
    try {
      const r = await fetch("/api/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eid: event?.id, ...payload }),
      });
      if (r.status === 401) {
        location.replace("/login");
        return false;
      }
      const data = await r.json();
      if (!r.ok) {
        if (payload.action === "sale" && [400, 409].includes(r.status)) {
          clearPending(payload.id);
        }
        throw Error(data.error);
      }
      onSuccess?.(data);
      etag.current = "";
      S(data);
      R(true);
      if (payload.action === "event") select(data.event.id);
      N("Tersimpan.");
      return true;
    } catch (e) {
      E(
        e instanceof TypeError
          ? "Koneksi terputus. Coba simpan kembali."
          : e.message,
      );
      return false;
    } finally {
      generation.current++;
      locked.current = false;
      W(false);
    }
  }
  function resetVoucher() {
    A("");
    B("");
    M("QRIS");
    setDraftEvent(null);
    setTimeout(() => first.current?.focus(), 0);
  }
  async function checkPayment() {
    if (locked.current || !pending) return;
    locked.current = true;
    W(true);
    E("");
    try {
      const r = await fetch(
        "/api/pos?" +
          new URLSearchParams({
            event: String(pending.eid),
            receipt: pending.id,
          }),
        { cache: "no-store" },
      );
      if (r.status === 401) {
        location.replace("/login");
        return;
      }
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      if (!data.receipt) {
        setMissing(true);
        return;
      }
      U(receiptMessage(pending, data.receipt));
      clearPending(pending.id);
      resetVoucher();
      D("");
    } catch (e) {
      E(
        e instanceof TypeError
          ? "Gagal memeriksa pembayaran. Coba lagi."
          : e.message,
      );
    } finally {
      locked.current = false;
      W(false);
    }
  }
  async function save(action: string) {
    setMissing(false);
    let request,
      recovered = false;
    try {
      request =
        action === "sale"
          ? pending ||
            (await navigator.locks.request(pendingKey, () => {
              const existing = pendingPayment(localStorage, pendingKey, null);
              if (existing) {
                recovered = true;
                return existing;
              }
              return pendingPayment(localStorage, pendingKey, {
                tenant,
                amount: amt,
                method,
                ...confirmation.current,
              });
            }))
          : {
              action,
              sid: session?.id,
              ...(action === "end" ? confirmation.current : {}),
            };
    } catch {
      E("Penyimpanan browser tidak tersedia. Pembayaran belum dikirim.");
      return;
    }
    if (action === "sale") {
      setPending(request);
      A(request.tenant);
      B(String(request.amount));
      M(request.method);
      if (recovered) return;
    }
    if (
      !(await run(request, (data) => {
        if (action === "sale") {
          U(receiptMessage(request, data.receipt));
          clearPending(request.id);
        }
      }))
    )
      return;
    D("");
    if (action === "sale") {
      resetVoucher();
    }
    reset();
  }
  useEffect(() => {
    const apply = () => {
      const view = decodeURIComponent(location.hash.slice(1));
      T(
        (isDeveloper ? developerTabs : tabs).includes(view)
          ? view
          : "Kasir",
      );
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [isDeveloper]);
  const nav = (t: string) => {
    location.hash = t;
    T(t);
    E("");
    N("");
    U("");
  };
  async function logout() {
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      if (!r.ok) throw Error();
      location.replace("/login");
    } catch {
      E("Gagal keluar. Coba lagi.");
    }
  }
  const gate = !event
    ? "Belum ada event yang tersedia."
    : !event.active
      ? "Event belum aktif atau sudah ditutup."
      : session && !active
        ? "Sesi sedang digunakan oleh " + session.cashier + "."
        : !active
          ? "Mulai sesi kasir untuk mencatat pembayaran."
          : "";
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          nyaris<span>popup.</span>
        </div>
        <nav aria-label="Navigasi utama">
          {(state.admin ? developerTabs : tabs).map((t) => (
            <button
              key={t}
              className={tab === t ? "on" : ""}
              aria-current={tab === t ? "page" : undefined}
              onClick={() => nav(t)}
            >
              <Icon name={t} />
              {t === accountsTab ? <><span className="account-nav-full">Account Management</span><span className="account-nav-short">Akun</span></> : t === "Sesi" ? "Sesi Kasir" : t}
            </button>
          ))}
        </nav>
        <button
          className="profile profile-trigger"
          aria-label={`Buka profil ${state.user.name}`}
          aria-haspopup="dialog"
          onClick={() => profileDialog.current?.showModal()}
        >
          <b aria-hidden="true">{state.user.name.slice(0, 2).toUpperCase()}</b>
          <span>{state.user.name}<small>Profil</small></span>
        </button>
      </aside>
      <dialog ref={profileDialog} aria-labelledby="profile-title" className="account-dialog">
        <div className="account-heading">
          <h2 id="profile-title">Profil</h2>
          <button autoFocus aria-label="Tutup profil" onClick={() => profileDialog.current?.close()}>×</button>
        </div>
        <div className="profile-identity"><b aria-hidden="true">{state.user.name.slice(0, 2).toUpperCase()}</b><div><strong>{state.user.name}</strong><small>{state.user.role === "developer" ? "Developer" : "Kasir"}</small></div></div>
        <PasswordChange />
        <button onClick={() => { profileDialog.current?.close(); void logout(); }}>Keluar</button>
      </dialog>
      <main>
        <header>
          <span>
            Nyaris Popup <i>/</i> <strong>{tab}</strong>
          </span>
          <span className="online">
            <em /> {!event ? "Belum ada event" : event.active ? "Event aktif" : "Event nonaktif"}
          </span>

        </header>
        <div
          className={
            (tab === "Kelola" || tab === accountsTab)
              ? "content settings-content"
              : tab === "Kasir"
                ? "content cashier-content"
                : "content"
          }
        >
          {(tab === "Kelola" || tab === accountsTab) && <h1>{tab}</h1>}
          {tab !== accountsTab && state.events.length > 0 && (
            <label className="eventpick">
              Event{" "}
              <select
                disabled={busy || !!pending}
                value={selected || event?.id || ""}
                onChange={(e) => {
                  if (
                    (tenant || amt > 0) &&
                    !window.confirm("Ganti event dan kosongkan voucher?")
                  )
                    return;
                  generation.current++;
                  select(Number(e.target.value));
                  R(false);
                  A("");
                  B("");
                  M("QRIS");
                  reset();
                  setDraftEvent(null);
                  U("");
                  N("");
                }}
              >
                {!event && <option value="">Pilih event</option>}
                {state.events.map((v) => (
                  <option value={v.id} key={v.id}>
                    {v.name}
                    {v.current ? " · Utama" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {tab !== "Kelola" && tab !== accountsTab && (
            <div className="pageTitle">
              <h2>
                {tab === "Kasir"
                  ? "Meja kasir"
                  : tab === "Sesi"
                    ? "Sesi kasir"
                    : tab}
              </h2>
              {event?.active && (tab === "Sesi" || tab === "Kasir") && (
                <span className="session">
                  {!ready ? "Menghubungkan…" : active ? "Sesi Anda aktif" : session ? `Kasir bertugas: ${session.cashier}` : "Belum ada sesi aktif"}
                </span>
              )}
            </div>
          )}
          {tab === "Kasir" && gate && !pending && (
            <section className="panel gate">
              <p>{gate}</p>
              {event?.active && !session && (
                <button className="primary" disabled={busy || !ready} onClick={() => save("start")}>
                  Mulai Sesi
                </button>
              )}
              {state.admin && !event && (
                <button onClick={() => nav("Kelola")}>Siapkan event</button>
              )}
            </section>
          )}
          {tab === "Kasir" ? gate && !pending ? (success && <p role="status">{success}</p>) : (
            <div className="grid">
              <fieldset
                disabled={!!pending}
                className="panel form"
                style={{ minWidth: 0, margin: 0 }}
              >
                <h3>
                  <small>01</small> Pilih tenant
                </h3>
                <div className="tenants">
                  {tenants.map((t, i) => (
                    <button
                      key={t}
                      ref={i === 0 ? first : undefined}
                      aria-pressed={t === tenant}
                      onClick={() => {
                        A(t);
                        setDraftEvent(event?.id ?? null);
                        reset();
                      }}
                    >
                      <b className={"tile c" + (i % 6)}>
                        {t
                          .split(/\s+/)
                          .map((w) => w[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                      </b>
                      {t}
                      {t === tenant && <sup>✓</sup>}
                    </button>
                  ))}
                </div>
                <h3>
                  <small>02</small> Nominal pembayaran
                </h3>
                <label className="money">
                  <span>Rp</span>
                  <input
                    aria-label="Nominal rupiah"
                    inputMode="numeric"
                    placeholder="0"
                    value={amount ? amt.toLocaleString("id-ID") : ""}
                    onChange={(e) => {
                      const n = e.target.value.replaceAll(".", "");
                      if (/^\d{0,12}$/.test(n)) {
                        B(n);
                        reset();
                      }
                    }}
                  />
                </label>
                <div className="quick">
                  {[5000, 10000].map((n) => (
                    <button
                      key={n}
                      onClick={() => {
                        B(String(Math.min(999999999999, amt + n)));
                        reset();
                      }}
                    >
                      + {rupiah(n)}
                    </button>
                  ))}
                </div>
                <h3>
                  <small>03</small> Metode pembayaran
                </h3>
                <div className="methods">
                  {["QRIS", "Cash"].map((m) => (
                    <button
                      key={m}
                      aria-pressed={m === method}
                      onClick={() => {
                        M(m);
                        reset();
                      }}
                    >
                      <Icon name={m} />
                      {m}
                      <i>{m === method ? "●" : "○"}</i>
                    </button>
                  ))}
                </div>
              </fieldset>
              <section className="summary">
                <p className="compact-voucher">
                  {tenant || "Pilih tenant"} · <strong>{rupiah(amt)}</strong> ·{" "}
                  {method}
                </p>
                <div className="receipt">
                  <div className="receiptHead">
                    <Icon name="ticket" />
                    <b>Ringkasan voucher</b>
                  </div>
                  <div className="rlabel">TOTAL PEMBAYARAN</div>
                  <strong className="total">{rupiah(amt)}</strong>
                  <dl>
                    <dt>Tenant</dt>
                    <dd>{tenant || "Belum dipilih"}</dd>
                    <dt>Metode</dt>
                    <dd>{method}</dd>
                    <dt>Kasir</dt>
                    <dd>{state.user.name}</dd>
                  </dl>
                  <div className="stub">
                    <span className="barcode" />
                    <b>NYARIS POPUP</b>
                  </div>
                </div>
                <p className="hint">
                  ⓘ &nbsp;{" "}
                  {method === "QRIS"
                    ? "Pastikan pembayaran masuk di GoPay Merchant."
                    : "Pastikan uang tunai sudah diterima."}
                </p>
                <button
                  className="primary"
                  disabled={(!pending && !valid) || busy}
                  onClick={() => {
                    if (!pending)
                      confirmation.current = { eid: event.id, sid: session.id };
                    setMissing(false);
                    D("sale");
                  }}
                >
                  {pending
                    ? "Periksa pembayaran tertunda"
                    : "Konfirmasi Pembayaran"}{" "}
                  <span>→</span>
                </button>
                <p role="status">{success}</p>
              </section>
            </div>
          ) : tab === "Transaksi" ? (
            <History
              key={event?.id}
              s={state}
              run={run}
              busy={busy || !ready}
            />
          ) : tab === "Ringkasan" ? (
            <Reports s={state} />
          ) : tab === accountsTab && state.admin ? (
            <AccountManagement s={state} run={run} busy={busy || !ready} />
          ) : tab === "Kelola" && state.admin ? (
            <Management
              key={event?.id}
              s={state}
              run={run}
              busy={busy || !ready}
            />
          ) : (
            <section className="panel stack session-activity">
              <h3>Aktivitas sesi</h3>
              {!state.sessions.length && <p>{!event ? "Belum ada event untuk memulai sesi kasir." : !event.active ? "Sesi dapat dimulai setelah developer mengaktifkan event." : "Mulai sesi untuk mencatat transaksi atas nama Anda."}</p>}
              {state.sessions.map((s) => {
                const rows = state.sales.filter(
                  (v) => v.sid === s.id && v.status === "paid",
                );
                return (
                  <article key={s.id}>
                    <div>
                      <b>
                        {s.cashier} · Sesi {s.id}
                      </b>
                      <small>
                        {clock(s.start)} – {s.end ? clock(s.end) : "Sekarang"}{" "}
                        WIB ·{" "}
                        {Math.max(
                          0,
                          Math.floor(
                            (Date.parse(s.end || state.refreshed) -
                              Date.parse(s.start)) /
                              60000,
                          ),
                        )}{" "}
                        menit
                      </small>
                    </div>
                    <div>
                      {rupiah(sum(rows))}
                      <small>
                        {rows.length} transaksi · Cash{" "}
                        {rupiah(sum(rows.filter((v) => v.method === "Cash")))} ·
                        QRIS{" "}
                        {rupiah(sum(rows.filter((v) => v.method === "QRIS")))}
                      </small>
                    </div>
                  </article>
                );
              })}
              {active ? (
                <button
                  className="primary"
                  disabled={busy || !ready}
                  onClick={() => {
                    confirmation.current = { eid: event.id, sid: session.id };
                    D("end");
                  }}
                >
                  Akhiri Sesi
                </button>
              ) : session && state.admin ? (
                <form
                  className="editor"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run({
                      action: "recover",
                      sid: session.id,
                      reason: new FormData(e.currentTarget).get("reason"),
                    });
                  }}
                >
                  <label>
                    Alasan menutup sesi {session.cashier}
                    <input required name="reason" />
                  </label>
                  <button disabled={busy || !ready}>
                    Tutup sesi yang ditinggalkan
                  </button>
                </form>
              ) : event?.active && !session && (
                <button
                  disabled={busy || !ready}
                  onClick={() => save("start")}
                >
                  Mulai Sesi
                </button>
              )}
            </section>
          )}
          {notice && tab !== "Kasir" && <p role="status">{notice}</p>}
          {draftEvent !== null && draftEvent !== event?.id && tenant && (
            <p role="alert">
              Event berubah. Periksa voucher dan pilih tenant kembali.
            </p>
          )}
          {!ready && <p role="status">Menghubungkan ke server…</p>}
          {!dialog && err && <p role="alert">{err}</p>}
        </div>
      </main>
      <dialog
        aria-labelledby="confirmation-title"
        aria-describedby="confirmation-summary"
        ref={modal}
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else D("");
        }}
      >
        <h2 id="confirmation-title">
          {dialog === "sale"
            ? pending
              ? missing
                ? "Pembayaran belum tercatat"
                : "Periksa pembayaran tertunda"
              : "Pembayaran diterima?"
            : "Akhiri sesi kasir?"}
        </h2>
        <p id="confirmation-summary">
          {dialog === "sale"
            ? (pending?.tenant || tenant) +
              " · " +
              rupiah(pending?.amount || amt) +
              " · " +
              (pending?.method || method)
            : "Total sesi " +
              rupiah(sum(state.sales.filter((s) => s.sid === session?.id)))}
        </p>
        <p>
          {dialog === "sale"
            ? pending && !missing
              ? "Periksa apakah voucher sudah tersimpan."
              : (pending?.method || method) === "QRIS"
                ? "Pastikan nominal sudah masuk di GoPay Merchant."
                : "Pastikan uang tunai sudah diterima."
            : "Transaksi berikutnya membutuhkan sesi baru."}
        </p>
        {err && <p role="alert">{err}</p>}
        <button disabled={busy} onClick={() => D("")}>
          Kembali
        </button>{" "}
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            dialog === "sale" && pending && !missing
              ? checkPayment()
              : save(dialog)
          }
        >
          {busy
            ? pending && !missing && dialog === "sale"
              ? "Memeriksa…"
              : "Menyimpan…"
            : dialog === "sale"
              ? pending
                ? missing
                  ? "Simpan pembayaran"
                  : "Periksa pembayaran"
                : "Ya, simpan pembayaran"
              : "Akhiri Sesi"}
        </button>
      </dialog>
    </div>
  );
}
