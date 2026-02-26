import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { jsonResponse } from "./_shared/utils.mts";

export default async (req: Request, context: Context) => {
  try {
  const metaStore = getStore("meta");
  const data = await metaStore.get("last_sync.json", { type: "json" }).catch(() => null);
  if (!data) return jsonResponse({ ok: false, error: "No last_sync.json yet. Run /api/sync first." }, 404);
  return jsonResponse({ ok: true, lastSync: data });


  } catch (err: any) {
    const message = err?.message ? String(err.message) : String(err);
    return jsonResponse({ ok: false, error: message, where: "debug-last-sync" }, 500);
  }
};
