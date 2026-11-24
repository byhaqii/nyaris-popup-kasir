"use client";

import { useEffect, useRef, useState } from "react";

async function compress(file: File): Promise<Blob> {
  if (file.size > 20 * 1024 * 1024) throw Error("Pilih foto berukuran maksimal 20 MB.");
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw Error("Browser tidak dapat memproses foto.");
    context.fillStyle = "#fff";
    context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0,canvas.width,canvas.height);
    for (const quality of [0.82,0.65,0.45]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve,"image/jpeg",quality));
      if (blob && blob.size <= 512 * 1024) return blob;
    }
    throw Error("Foto masih terlalu besar. Coba foto lain.");
  } catch (error) {
    throw Error(error instanceof Error ? error.message : "Foto tidak dapat dibaca. Pilih foto JPG, PNG, atau WebP.");
  } finally {
    URL.revokeObjectURL(source);
  }
}

export default function ProofPicker({ eventId, value, disabled, onChange, onBusyChange }: {
  eventId: number;
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [candidate, setCandidate] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!candidate) { setPreview(""); return; }
    const url = URL.createObjectURL(candidate);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [candidate]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      onBusyChange(false);
    };
  }, [onBusyChange]);

  async function upload(file: Blob) {
    const data = new FormData();
    data.set("event",String(eventId));
    data.set("photo",file,"bukti-pembayaran.jpg");
    const response = await fetch("/api/proofs",{method:"POST",body:data,signal:controller.current.signal});
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "Foto gagal disimpan. Coba lagi.");
    onChange(result.id);
    setCandidate(null);
  }
  async function attach(file: File | Blob) {
    controller.current?.abort();
    controller.current = new AbortController();
    const timeout = setTimeout(() => controller.current?.abort("timeout"), 30000);
    setUploading(true);
    onBusyChange(true);
    setError("");
    onChange("");
    let saved = false;
    try {
      const image = file instanceof File ? await compress(file) : file;
      if (controller.current.signal.aborted) return;
      setCandidate(image);
      await upload(image);
      saved = true;
    } catch (error) {
      if (mounted.current) setError(controller.current.signal.reason === "timeout"
        ? "Unggahan terlalu lama. Coba unggah lagi."
        : error instanceof Error ? error.message : "Foto gagal disimpan. Coba lagi.");
    } finally {
      clearTimeout(timeout);
      if (mounted.current) {
        setUploading(false);
        onBusyChange(!saved);
      }
    }
  }
  const src = preview || (value ? "/api/proofs/" + value : "");
  return <section className="proof-picker" aria-labelledby="proof-label">
    <h3 id="proof-label">Bukti pembayaran <small>Opsional</small></h3>
    <input ref={camera} hidden type="file" accept="image/*" capture="environment" disabled={disabled || uploading}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void attach(file); }} />
    <input ref={gallery} hidden type="file" accept="image/*" disabled={disabled || uploading}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void attach(file); }} />
    {src && <img className="proof-preview" src={src} alt="Foto bukti pembayaran" width={240} height={160} />}
    <div className="actions">
      <button type="button" disabled={disabled || uploading} onClick={() => camera.current?.click()}>Ambil foto</button>
      <button type="button" disabled={disabled || uploading} onClick={() => gallery.current?.click()}>{src ? "Ganti foto" : "Pilih dari galeri"}</button>
      {(src || error) && <button type="button" disabled={disabled || uploading} onClick={() => { onChange(""); setCandidate(null); setError(""); onBusyChange(false); }}>Hapus foto</button>}
      {candidate && error && <button type="button" disabled={disabled || uploading} onClick={() => void attach(candidate)}>Coba unggah lagi</button>}
    </div>
    {uploading && <p role="status">Menyimpan foto…</p>}
    {value && !uploading && <p role="status">Foto siap dilampirkan.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
