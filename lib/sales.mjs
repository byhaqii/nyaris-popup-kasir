export function grossSales(rows) {
  return rows.reduce((total, row) => row.status === "paid" ? total + row.amount : total, 0);
}
