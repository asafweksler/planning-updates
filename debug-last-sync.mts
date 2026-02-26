import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { daysBackKeys, jsonResponse } from "./_shared/utils.mts";

export default async (req: Request, context: Context) => {
  try {
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days") || "30")));
  const changeType = url.searchParams.get("change_type") || url.searchParams.get("changeType") || "";
  const levelsParam = url.searchParams.get("levels") || url.searchParams.get("level") || "";
  const district = url.searchParams.get("district") || "";
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit") || "200")));

  const levels = levelsParam
    ? levelsParam.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];


  const eventsStore = getStore("daily-events");

  // Load per-day buckets (UTC days)
  const keys = daysBackKeys(days);
  const buckets = await Promise.all(
    keys.map(async (k) => {
      const key = `events/${k}.json`;
      return eventsStore.get(key, { type: "json" }).catch(() => null);
    })
  );

  let items: any[] = [];
  for (const b of buckets) {
    const arr = Array.isArray(b?.items) ? b.items : [];
    items.push(...arr);
  }

  // Filters
  const normalizedType = changeType || "";
  items = items.filter((it) => {
    if (!normalizedType) return true;
    const t = String(it?.changeType || it?.change_type || "");
    const label = String(it?.changeLabel || "");
    const norm = String(it?.statusNorm || "");
    if (normalizedType === "approved") return label === "אושרה" || norm === "approved";
    if (normalizedType === "deposited") return label === "הופקדה" || norm === "deposited";
    if (normalizedType === "published") return label === "פורסמה" || norm === "published";
    if (normalizedType === "changed") return label === "עודכנה" || t === "changed";
    if (normalizedType === "new") return t === "new";
    return true;
  });

  if (district) items = items.filter((it) => String(it?.district || "") === district);

  if (levels.length) {
    items = items.filter((it) => {
      const lvl = String(it?.authorityLevel || "unknown").toLowerCase();
      if (lvl === "unknown") return false;
      return levels.includes(lvl);
    });
  }


  if (q) {
    items = items.filter((it) => {
      const hay = [
        it?.planNumber,
        it?.planName,
        it?.city,
        it?.district,
        it?.committee,
        it?.status,
        it?.summary,
      ]
        .filter(Boolean)
        .map((x) => String(x).toLowerCase())
        .join(" | ");
      return hay.includes(q);
    });
  }

  // Sort + limit
  items.sort((a, b) => {
    const ta = new Date(a?.changedAt || a?.detectedAt || 0).getTime();
    const tb = new Date(b?.changedAt || b?.detectedAt || 0).getTime();
    return tb - ta;
  });

  items = items.slice(0, limit).map((it) => ({
    id: it.id,
    planNumber: it.planNumber,
    planName: it.planName,
    city: it.city,
    district: it.district,
    committee: it.committee,
    changeType: (it.changeLabel === "אושרה" || it.statusNorm === "approved") ? "approved" :
                (it.changeLabel === "הופקדה" || it.statusNorm === "deposited") ? "deposited" :
                (it.changeLabel === "פורסמה" || it.statusNorm === "published") ? "published" : "changed",
    changeLabel: it.changeLabel || "עודכנה",
    status: it.status || "עדכון",
    changedAt: it.changedAt || it.detectedAt,
    summary: it.summary || "תכנית עודכנה",
    sourceUrl: (it.mavatUrl && String(it.mavatUrl).includes("mavat.iplan.gov.il")) ? it.mavatUrl : (it.xplanUrl || it.sourceUrl || "#"),
  }));

  return jsonResponse({ items, count: items.length, days });


  } catch (err: any) {
    const message = err?.message ? String(err.message) : String(err);
    return jsonResponse({ ok: false, error: message, where: "updates" }, 500);
  }
};
