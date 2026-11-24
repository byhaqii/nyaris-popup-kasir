import { NextRequest, NextResponse } from "next/server";
import { openShared } from "../../../../lib/shared.mjs";
import { check, user } from "../../../../lib/store.mjs";
import { scope } from "../../../../lib/pos.mjs";
import { failure } from "../../../../lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { db, finish } = await openShared(false);
  try {
    const account = user(db, req.cookies.get("pos")?.value);
    check(account, "Silakan masuk.", 401);
    const { id } = await context.params;
    const proof = db.prepare("SELECT * FROM proofs WHERE id=?").get(id) as {
      image: Uint8Array; mime: string; eid: number; uid: number; sale_id: string | null;
    };
    check(proof && scope(db,account,proof.eid) && (proof.sale_id || proof.uid === account.id), "Foto tidak tersedia.", 404);
    return new NextResponse(new Uint8Array(proof.image), { headers: {
      "Content-Type": proof.mime,
      "Content-Disposition": 'inline; filename="bukti-pembayaran.jpg"',
      "Cache-Control": "private,no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    } });
  } catch (error) {
    return failure(error);
  } finally {
    await finish();
  }
}
