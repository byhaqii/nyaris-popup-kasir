import { openShared } from "../lib/shared.mjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { user } from "../lib/store.mjs";
import { snapshot } from "../lib/pos.mjs";
import Workspace from "./Workspace";
export const dynamic = "force-dynamic";
export default async function Page() {
  const { db, finish } = await openShared(false);
  try {
    const u = user(db, (await cookies()).get("pos")?.value);
    if (!u) redirect("/login");
    return <Workspace initial={structuredClone(snapshot(db, u, null))} />;
  } finally {
    await finish();
  }
}
