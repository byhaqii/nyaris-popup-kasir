// Keep the confirmed request intact when the network loses the response.
export function pendingPayment(storage, key, input) {
  const previous = storage.getItem(key);
  if (previous) return JSON.parse(previous);
  if (!input) return null;
  const request = { ...input, id: crypto.randomUUID(), action: "sale" };
  storage.setItem(key, JSON.stringify(request));
  return request;
}
export function receiptMessage(request, sale) {
  if (!sale || sale.id !== request.id)
    throw Error("Status pembayaran belum diketahui. Coba periksa kembali.");
  const summary =
    sale.tenant +
    " · Rp" +
    sale.amount.toLocaleString("id-ID") +
    " · " +
    sale.method;
  if (sale.status !== "paid")
    return summary + ". Transaksi dibatalkan. Jangan stempel voucher.";
  if (
    sale.tenant !== request.tenant ||
    sale.amount !== request.amount ||
    sale.method !== request.method
  )
    return (
      summary +
      ". Transaksi sudah dikoreksi. Periksa voucher sebelum memberi stempel."
    );
  return summary + ". Tersimpan. Voucher boleh distempel.";
}

export function reservePayment(storage, key, input) {
  return navigator.locks.request(key, () => {
    const previous = pendingPayment(storage, key, null);
    return { request: previous || pendingPayment(storage, key, input), recovered: Boolean(previous) };
  });
}

export function forgetPayment(storage, key, id) {
  if (pendingPayment(storage, key, null)?.id === id) storage.removeItem(key);
}
