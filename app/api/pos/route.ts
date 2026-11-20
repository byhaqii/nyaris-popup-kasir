import { openShared } from "../../../lib/shared.mjs";
import { NextRequest, NextResponse } from "next/server";
import {
  atomic,
  check,
  user,
  active,
  day,
  now,
  digest,
} from "../../../lib/store.mjs";
import { snapshot, mutate, scope } from "../../../lib/pos.mjs";
import { body, failure } from "../../../lib/http";
export const dynamic = "force-dynamic";
async function handle(req: NextRequest, write: boolean) {
  const { db, finish } = await openShared(write);
  try {
    const p = write ? await body(req) : null;
    return atomic(
      db,
      () => {
        const u = user(db, req.cookies.get("pos")?.value);
        check(u, "Silakan masuk.", 401);
        const id = write
          ? mutate(db, u, p) || p.eid
          : req.nextUrl.searchParams.get("event");
        const event = scope(db, u, id);
        if (!write && req.nextUrl.searchParams.has("receipt")) {
          check(event && id, "Event tidak tersedia.", 403);
          const receipt = db
            .prepare(
              "SELECT t.id,t.tenant,t.amount,t.method,t.status FROM sales t JOIN sessions s ON s.id=t.sid WHERE t.eid=? AND s.uid=? AND t.id=?",
            )
            .get(event.id, u.id, req.nextUrl.searchParams.get("receipt"));
          return NextResponse.json(
            { receipt: receipt || null },
            { headers: { "Cache-Control": "private, no-store" } },
          );
        }
        const revision = db
          .prepare("SELECT revision FROM changes WHERE id=1")
          .get().revision;
        const etag =
          '"' +
          digest(
            JSON.stringify([
              revision,
              u.id,
              event?.id,
              active(event),
              day(now()),
            ]),
          ) +
          '"';
        if (!write && req.headers.get("if-none-match") === etag)
          return new NextResponse(null, {
            status: 304,
            headers: { ETag: etag, "Cache-Control": "private,no-store" },
          });
        const state = snapshot(db, u, id);
        const receipt =
          p?.action === "sale"
            ? state.sales.find((s) => s.id === p.id)
            : undefined;
        return NextResponse.json(
          { ...state, receipt },
          {
            headers: { ETag: etag, "Cache-Control": "private, no-store" },
          },
        );
      },
      write,
    );
  } catch (e) {
    return failure(e);
  } finally {
    await finish();
  }
}
export const GET = (req: NextRequest) => handle(req, false);
export const POST = (req: NextRequest) => handle(req, true);
