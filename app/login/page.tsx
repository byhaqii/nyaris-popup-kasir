"use client";
import { useState } from "react";
export default function Login() {
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
          <label>
            Kata sandi
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Memeriksa…" : "Masuk →"}
          </button>
          <p role="alert">{error}</p>
        </form>
      </div>
    </main>
  );
}
