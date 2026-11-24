import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { openShared } from "../../../lib/shared.mjs";
import { atomic, check, now, user } from "../../../lib/store.mjs";
import { scope } from "../../../lib/pos.mjs";
import { failure } from "../../../lib/http";

export const runtime = "nodejs";
const MAX_SIZE = 512 * 1024;

export async function POST(req: NextRequest) {
  let finish;
  try {
    const origin = req.headers.get("origin");
    check(!origin || new URL(origin).host === req.headers.get("host"), "Origin tidak valid.", 403);
    check(req.headers.get("content-type")?.startsWith("multipart/form-data"), "Gunakan lampiran foto.", 415);
    check(Number(req.headers.get("content-length") || 0) <= MAX_SIZE + 16384, "Foto terlalu besar.", 413);
    const form = await req.formData();
    const photo = form.get("photo");
    check(photo instanceof File && photo.size > 0 && photo.size <= MAX_SIZE, "Foto maksimal 512 KB setelah dikompres.", 413);
    const image = Buffer.from(await (photo as File).arrayBuffer());
    check(image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff, "Format foto tidak valid. Pilih foto lain.", 415);
    const shared = await openShared(true);
    finish = shared.finish;
    const { db } = shared;
    const id = atomic(db, () => {
      const account = user(db, req.cookies.get("pos")?.value);
      check(account, "Silakan masuk.", 401);
      const event = scope(db, account, form.get("event"));
      check(event?.current && event?.mode === "on", "Pilih event aktif untuk melampirkan foto.", 409);
      const id = randomUUID();
      db.prepare("INSERT INTO proofs(id,eid,uid,image,mime,created) VALUES(?,?,?,?,?,?)")
        .run(id,event.id,account.id,image,"image/jpeg",now());
      return id;
    });
    return NextResponse.json({ id }, { headers: { "Cache-Control": "private,no-store" } });
  } catch (error) {
    return failure(error);
  } finally {
    await finish?.();
  }
}
