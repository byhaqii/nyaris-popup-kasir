"use client";
import { useState } from "react";
export default function Login() {
  const [visible, setVisible] = useState(false);
  const [error, E] = useState(""),
    [busy, B] = useState(false);
  return (
    <main className="login">
      <div className="loginframe">
        <section className="loginpaper">
          <div className="brand">
            nyaris<span>popup.</span>
          </div>
          <div className="stamp" aria-hidden="true">
            NYARIS
            <br />
            POPUP
          </div>
          <div className="loginpaperfoot">
            <span className="barcode" /> <span>Kasir internal</span>
          </div>
        </section>
        <form
          className="panel editor"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(e.currentTarget));
            B(true);
            E("");
            try {
              const r = await fetch("/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...data, action: "login" }),
              });
              if (!r.ok) throw Error((await r.json()).error);
              location.replace("/");
            } catch (e) {
              E(e.message);
              B(false);
            }
          }}
        >
          <h1>Masuk ke kasir</h1>
          <p>Gunakan akun staf Nyaris Popup.</p>
          <label>
            Username
            <input name="name" autoComplete="username" required autoFocus />
          </label>
          <div className="password-control">
            <label htmlFor="login-password">Kata sandi</label>
            <span className="password-field">
              <input
                id="login-password"
                name="password"
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                required
              />
              <button type="button" className="password-toggle"
                aria-label={visible ? "Sembunyikan kata sandi" : "Lihat kata sandi"}
                aria-pressed={visible} onClick={() => setVisible(!visible)}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {visible ? <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>
                    : <><path d="m3 3 18 18M10.6 5.1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3.2 4.2M6.2 6.2A19 19 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.3-1.3M10 10a3 3 0 0 0 4 4" /></>}
                </svg>
              </button>
            </span>
          </div>
          <button className="primary" disabled={busy}>
            {busy ? "Sedang masuk…" : "Masuk →"}
          </button>
          <p role="alert">{error}</p>
        </form>
      </div>
    </main>
  );
}
