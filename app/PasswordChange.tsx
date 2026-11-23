"use client";
import { useRef, useState } from "react";
export default function PasswordChange() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  return (
    <>
      <button
        onClick={() => {
          setDone(false);
          setError("");
          dialog.current.showModal();
        }}
      >
        Ganti kata sandi
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="password-title"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <h2 id="password-title">Ubah kata sandi</h2>
        {done ? (
          <>
            <p role="status">
              Kata sandi berhasil diubah. Perangkat lain telah keluar.
            </p>
            <button onClick={() => dialog.current.close()}>Selesai</button>
          </>
        ) : (
          <form
            className="editor"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const data = new FormData(form);
              if (data.get("newPassword") !== data.get("confirm")) {
                setError("Konfirmasi kata sandi tidak cocok.");
                return;
              }
              setBusy(true);
              setError("");
              try {
                const r = await fetch("/api/auth", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "password",
                    password: data.get("password"),
                    newPassword: data.get("newPassword"),
                  }),
                });
                if (!r.ok) throw Error((await r.json()).error);
                form.reset();
                setDone(true);
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Kata sandi saat ini
              <input
                required
                type="password"
                name="password"
                autoComplete="current-password"
              />
            </label>
            <label>
              Kata sandi baru (minimal 8 karakter)
              <input
                required
                type="password"
                name="newPassword"
                minLength={8}
                maxLength={256}
                autoComplete="new-password"
              />
            </label>
            <label>
              Ulangi kata sandi baru
              <input
                required
                type="password"
                name="confirm"
                autoComplete="new-password"
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <div className="actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  dialog.current.querySelector("form")?.reset();
                  dialog.current.close();
                }}
              >
                Batal
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Menyimpan…" : "Simpan"}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
