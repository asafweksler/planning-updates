import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { fetchRecentPlans, normalizeStatus } from "./_shared/xplan.mts";
import { jsonResponse, sha256, utcDayKey } from "./_shared/utils.mts";

const DEFAULT_QUERY_URL =
  process.env.XPLAN_QUERY_URL ||
  "https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/Xplan/MapServer/0/query";

const LOOKBACK_DAYS = Number(process.env.SYNC_LOOKBACK_DAYS || "30");
const PAGE_SIZE = Number(process.env.XPLAN_PAGE_SIZE || "200");
const MAX_PAGES = Number(process.env.XPLAN_MAX_PAGES || "4");

// Optional overrides if autodetection isn't perfect
const OVERRIDES = {
  planNumberField: process.env.XPLAN_PLAN_NUMBER_FIELD || undefined,
  planNameField: process.env.XPLAN_PLAN_NAME_FIELD || undefined,
  statusField: process.env.XPLAN_STATUS_FIELD || undefined,
  changedAtField: process.env.XPLAN_CHANGED_AT_FIELD || undefined,
  cityField: process.env.XPLAN_CITY_FIELD || undefined,
  districtField: process.env.XPLAN_DISTRICT_FIELD || undefined,
  committeeField: process.env.XPLAN_COMMITTEE_FIELD || undefined,
};

type StoredPlan = {
  planId: string;
  planNumber: string;
  planName: string;
  city: string;
  district: string;
  committee: string;
  status: string;
  statusNorm: string;
  authorityLevel: "local" | "district" | "national" | "unknown";
  changedAt: string | null;
  xplanUrl: string | null;
  mavatUrl: string | null;
  hash: string;
};

function computePlanHash(p: any) {
  return sha256(JSON.stringify({
    planNumber: p.planNumber,
    planName: p.planName,
    city: p.city,
    district: p.district,
    committee: p.committee,
    status: p.status,
    statusNorm: p.statusNorm,
    authorityLevel: p.authorityLevel,
    changedAt: p.changedAt,
  }));
}
function extractMavatUrlOrId(attrs: Record<string, any>, planNumber: string) {
  // 1) אם יש URL של MAVAT כבר בתוך אחד השדות – נשתמש בו
  for (const v of Object.values(attrs || {})) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    const m = s.match(/https?:\/\/mavat\.iplan\.gov\.il\/SV4\/1\/\d{6,14}\/310/);
    if (m) {
      const id = m[0].match(/SV4\/1\/(\d{6,14})\/310/)?.[1] ?? null;
      return { mavatUrl: m[0], mavatId: id };
    }
  }

  // 2) לחפש שדה “דמוי מזהה מבט”
  const keyPatterns = [/mavat/i, /sv4/i, /iplan/i, /taba/i, /plan.?id/i, /pl.?id/i, /tochnit.?id/i];
  for (const [k, v] of Object.entries(attrs || {})) {
    if (!keyPatterns.some((p) => p.test(k))) continue;
    const s = String(v ?? "").trim();
    if (/^\d{6,14}$/.test(s)) {
      return {
        mavatUrl: `https://mavat.iplan.gov.il/SV4/1/${encodeURIComponent(s)}/310`,
        mavatId: s,
      };
    }
  }

  // 3) אם מספר התכנית עצמו מספרי “ארוך” – לפעמים זה ה-ID
  const pn = String(planNumber || "").trim();
  if (/^\d{6,14}$/.test(pn)) {
    return {
      mavatUrl: `https://mavat.iplan.gov.il/SV4/1/${encodeURIComponent(pn)}/310`,
      mavatId: pn,
    };
  }

  return { mavatUrl: null, mavatId: null };
}

export default async (req: Request, context: Context) => {
  try {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Use POST" }, 405);
  }

let requestedLevels: Array<"local" | "district" | "national"> | null = null;
try {
  const txt = await req.text();
  if (txt) {
    const body = JSON.parse(txt);
    const levels = Array.isArray(body?.levels) ? body.levels : null;
    if (levels) {
      requestedLevels = levels
        .map((x: any) => String(x).toLowerCase())
        .filter((x: string) => ["local", "district", "national"].includes(x)) as any;
      if (requestedLevels.length === 0) requestedLevels = null;
    }
  }
} catch {
  // ignore
}

const envLevels = (process.env.SYNC_LEVELS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const selectedLevels = (requestedLevels && requestedLevels.length)
  ? requestedLevels
  : (envLevels.length ? (envLevels.filter((x) => ["local","district","national"].includes(x)) as any) : ["local","district","national"]);

const plansStore = getStore("plans-latest");

  const eventsStore = getStore("daily-events");
  const metaStore = getStore("meta");

  const startedAt = new Date().toISOString();
  const dayKey = utcDayKey(new Date());
  const runId = sha256(`${startedAt}:${Math.random()}`).slice(0, 12);

  const { plans, info } = await fetchRecentPlans({
    queryUrl: DEFAULT_QUERY_URL,
    lookbackDays: LOOKBACK_DAYS,
    pageSize: PAGE_SIZE,
    maxPages: MAX_PAGES,
    overrides: OVERRIDES,
  });

  let insertedPlans = 0;
  let updatedPlans = 0;
  let newEvents = 0;

  const runEvents: any[] = [];

  for (const p of plans) {
    // Filter by authority level (local/district/national). Unknown is excluded.
    const authorityLevel = classifyAuthority(p.committee);
    
    if (authorityLevel === "unknown" || !selectedLevels.includes(authorityLevel as any)) {
  continue;
}

    const key = `plan:${p.planId}`;
    const prev = (await plansStore.get(key, { type: "json" }).catch(() => null)) as StoredPlan | null;

    const hash = computePlanHash({ ...p, authorityLevel });
    const current: StoredPlan = {
      planId: p.planId,
      planNumber: p.planNumber,
      planName: p.planName,
      city: p.city,
      district: p.district,
      committee: p.committee,
      status: p.status,
      statusNorm: p.statusNorm,
      authorityLevel,
      changedAt: p.changedAt,
      xplanUrl: (p as any).xplanUrl ?? null,
      mavatUrl: (p as any).mavatUrl ?? null,
      hash,
    };

    if (!prev) {
      insertedPlans += 1;
      const evId = sha256(`new:${p.planId}:${hash}`).slice(0, 18);
      runEvents.push({
        id: `ev-${evId}`,
        changeType: "new",
        changeLabel: "חדשה",
        summary: "תכנית חדשה זוהתה במערכת XPLAN",
        ...current,
        detectedAt: startedAt,
      });
    } else if (prev.hash !== hash) {
      updatedPlans += 1;

      // Detect status change vs general change
      let changeType = "changed";
      let changeLabel = "עודכנה";
      let summary = "פרטי התכנית עודכנו במערכת XPLAN";

      if ((prev.statusNorm || prev.status) !== (current.statusNorm || current.status)) {
        changeType = "status_change";
        const norm = normalizeStatus(current.status);
        changeLabel = norm.changeLabel || current.statusNorm;
        summary = `סטטוס התכנית השתנה: ${prev.status || "לא ידוע"} → ${current.status || "לא ידוע"}`;
      }

      const evId = sha256(`${changeType}:${p.planId}:${hash}`).slice(0, 18);
      runEvents.push({
        id: `ev-${evId}`,
        changeType,
        changeLabel,
        summary,
        oldStatus: prev.status || null,
        newStatus: current.status || null,
        ...current,
        detectedAt: startedAt,
      });
    }

    // Upsert plan latest
    await plansStore.setJSON(key, current);
  }

  // Persist events into a per-day bucket
  if (runEvents.length) {
    const bucketKey = `events/${dayKey}.json`;
    const existing = (await eventsStore.get(bucketKey, { type: "json" }).catch(() => null)) as { items: any[] } | null;
    const existingItems = Array.isArray(existing?.items) ? existing!.items : [];

    // Deduplicate by id
    const seen = new Set(existingItems.map((x) => x?.id).filter(Boolean));
    const merged = [...existingItems];

    for (const ev of runEvents) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      merged.push(ev);
      newEvents += 1;
    }

    // Keep it bounded (MVP)
    merged.sort((a, b) => new Date(b.changedAt || b.detectedAt).getTime() - new Date(a.changedAt || a.detectedAt).getTime());
    const bounded = merged.slice(0, 10000);

    await eventsStore.setJSON(bucketKey, { items: bounded, updatedAt: startedAt, runId });
  }

  await metaStore.setJSON("last_sync.json", {
    ok: true,
    startedAt,
    dayKey,
    runId,
    fetched: plans.length,
    insertedPlans,
    updatedPlans,
    newEvents,
    info,
    selectedLevels,
  });

  return jsonResponse({
    ok: true,
    fetched: plans.length,
    insertedPlans,
    updatedPlans,
    newEvents,
    runId,
    dayKey,
    startedAt,
  });


   } catch (err: any) {
    const message = err?.message ? String(err.message) : String(err);
    const stack = err?.stack ? String(err.stack) : null;
    return jsonResponse({ ok: false, error: message, stack, where: "sync-xplan" }, 500);
  }
};
