import { NextRequest, NextResponse } from "next/server";
import { check } from "./store.mjs";
export async function body(req: NextRequest) {
  const origin = req.headers.get("origin");
  check(
    !origin ||
      origin === req.nextUrl.origin ||
      new URL(origin).host === req.headers.get("host"),
    "Origin tidak valid.",
    403,
  );
  check(
    req.headers.get("content-type")?.startsWith("application/json"),
    "Gunakan JSON.",
    415,
  );
  const raw = await req.text();
  check(raw.length <= 16384);
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    check(false);
  }
  check(p && typeof p === "object" && !Array.isArray(p));
  return p;
}
export function failure(e) {
  const status = e.status || 500;
  if (status === 500) console.error("POS request failed:", e.code || e.name);
  return NextResponse.json(
    {
      error:
        status === 500 ? "Terjadi kesalahan server. Coba lagi." : e.message,
    },
    { status },
  );
}
