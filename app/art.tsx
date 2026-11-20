export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    Kelola: "M4 7h16M4 17h16M8 4v6m8 4v6",
    Kasir: "M3 9h18l-2-6H5zm2 1v10h14V10M9 20v-6h5v6",
    Transaksi: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
    Ringkasan: "M4 20V11h3v9zm7 0V4h3v16zm7 0v-7h3v7z",
    Sesi: "M16 20v-2a4 4 0 0 0-8 0v2m4-9a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
    QRIS: "M3 3h6v6H3zm12 0h6v6h-6zM3 15h6v6H3zm12 0h2v3h4v3h-6z",
    Cash: "M2 6h20v13H2zm10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
    ticket: "M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4zM8 6v2m0 3v2m0 3v2",
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
