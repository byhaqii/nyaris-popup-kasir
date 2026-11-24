"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function Modal({ open, onClose, title, children, busy = false, error = "" }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  busy?: boolean;
  error?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    return () => {
      if (element.open) element.close();
      queueMicrotask(() => {
        if (document.activeElement !== document.body) return;
        const remaining = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
        remaining[remaining.length - 1]?.querySelector<HTMLButtonElement>("button")?.focus();
      });
    };
  }, [open]);
  return <dialog ref={dialog} className="action-modal" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget || busy) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    {open && <>
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button type="button" aria-label="Tutup dialog" disabled={busy} onClick={onClose}>×</button>
      </div>
      <div className="modal-body stack">{children}</div>
      {error && <p role="alert">{error}</p>}
    </>}
  </dialog>;
}

export function ActionModal({ title, trigger, children, busy = false, error = "", className = "modal-trigger" }: {
  title: string;
  trigger?: ReactNode;
  children: ReactNode;
  busy?: boolean;
  error?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={className} aria-haspopup="dialog" onClick={() => setOpen(true)}>{trigger || title}</button>
    <Modal title={title} open={open} onClose={() => setOpen(false)} busy={busy} error={error}>{children}</Modal>
  </>;
}
