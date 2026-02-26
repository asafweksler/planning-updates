import { safeString, toIsoMaybe } from "./utils.mts";

export type NormalizedPlan = {
  planId: string;
  planNumber: string;
  planName: string;
  city: string;
  district: string;
  committee: string;
  status: string;
  statusNorm: string;      // approved | deposited | published | changed | unknown
  changeLabel: string;     // אושרה | הופקדה | פורסמה | עודכנה | חדשה
  changedAt: string | null; // ISO
  xplanUrl: string | null;
  mavatUrl: string | null;
  authorityLevel: "local" | "district" | "national" | "unknown";
  raw: Record<string, any>;
};

type ArcGISField = { name: string; type?: string; alias?: string };
type LayerMeta = { fields?: ArcGISField[]; objectIdField?: string };

function pickField(
  fields: ArcGISField[],
  patterns: RegExp[],
  samples: Array<Record<string, any>> = [],
  opts?: { preferDate?: boolean; preferString?: boolean }
) {
  const preferDate = Boolean(opts?.preferDate);
  const preferString = Boolean(opts?.preferString);

  const candidates = fields
    .filter((f) => {
      const hay = `${f.name} ${f.alias ?? ""}`.toLowerCase();
      return patterns.some((p) => p.test(hay));
    })
    .map((f) => {
      const t = (f.type || "").toLowerCase();
      const isDate = t.includes("date");
      const isString = t.includes("string");

      // Score by type preference first
      let score = 0;
      if (preferDate && isDate) score += 50;
      if (preferString && isString) score += 20;
      if (!preferString && !preferDate) score += 0;

      // Extra points for alias match (often more human-meaningful)
      if (f.alias && patterns.some((p) => p.test(String(f.alias).toLowerCase()))) score += 5;

      // Use samples to pick the field that is most populated
      if (samples.length) {
        let filled = 0;
        for (const s of samples) {
          const v = s?.[f.name];
          if (v !== null && v !== undefined && String(v).trim() !== "") filled += 1;
        }
        score += Math.min(25, filled * 3); // cap
      }

      return { name: f.name, score };
    })
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.name ?? null;
}

export function normalizeStatus(raw: string) {
  const s = (raw || "").trim();
  if (!s) return { statusNorm: "unknown", changeLabel: "עודכנה" };

  if (/(אישור|אושר|מאושרת|מאושרה)/.test(s)) return { statusNorm: "approved", changeLabel: "אושרה" };
  if (/(הפקד|מופקדת|להפקדה)/.test(s)) return { statusNorm: "deposited", changeLabel: "הופקדה" };
  if (/(פרסום|פורסם|פורסמה)/.test(s)) return { statusNorm: "published", changeLabel: "פורסמה" };
  if (/(התנגד|השגות)/.test(s)) return { statusNorm: "published", changeLabel: "פורסמה" };

  return { statusNorm: "changed", changeLabel: "עודכנה" };
}

export async function discoverFields(queryUrl: string): Promise<{
  layerUrl: string;
  fields: ArcGISField[];
  planNumberField: string | null;
  planNameField: string | null;
  statusField: string | null;
  changedAtField: string | null;
  changedAtIsDate: boolean;
  cityField: string | null;
  districtField: string | null;
  committeeField: string | null;
  authorityField: string | null;
}> {
  const layerUrl = queryUrl.replace(/\/query\/?$/, "");
  const metaUrl = `${layerUrl}?f=pjson`;
  const res = await fetch(metaUrl, { headers: { "User-Agent": "planning-updates-netlify/0.1" } });
  if (!res.ok) throw new Error(`XPLAN meta HTTP ${res.status}`);
  const meta = (await res.json()) as LayerMeta;
  const fields = meta.fields || [];

  // Pull a small sample to choose the most populated fields (avoids 'wrong but empty' matches)
  let sampleAttrs: Array<Record<string, any>> = [];
  try {
    const sampleParams = new URLSearchParams();
    sampleParams.set("where", "1=1");
    sampleParams.set("outFields", "*");
    sampleParams.set("returnGeometry", "false");
    sampleParams.set("f", "json");
    sampleParams.set("resultRecordCount", "20");
    const sampleRes = await fetch(`${queryUrl}?${sampleParams.toString()}`, { headers: { "User-Agent": "planning-updates-netlify/0.1" } });
    if (sampleRes.ok) {
      const j = await sampleRes.json();
      const feats = Array.isArray(j?.features) ? j.features : [];
      sampleAttrs = feats.map((f: any) => f?.attributes || {}).filter(Boolean);
    }
  } catch {
    // ignore sample errors
  }

const planNumberField = pickField(
  fields,
  [/plan.*number/i, /mispar/i, /number/i, /tochnit/i, /pl.*num/i, /מספר/i, /תכנית/i, /תוכנית/i],
  sampleAttrs,
  { preferString: true }
);
const planNameField = pickField(
  fields,
  [/plan.*name/i, /name/i, /shem/i, /tochnit/i, /שם/i],
  sampleAttrs,
  { preferString: true }
);
const statusField = pickField(
  fields,
  [/status/i, /stat/i, /סטטוס/i, /מצב/i],
  sampleAttrs,
  { preferString: true }
);
const changedAtField = pickField(
  fields,
  [/last/i, /update/i, /edit/i, /modified/i, /decision/i, /date/i, /עדכון/i, /תאריך/i],
  sampleAttrs,
  { preferDate: true }
);

const cityField = pickField(
  fields,
  [/city/i, /local/i, /locality/i, /settle/i, /setl/i, /ישוב/i, /יישוב/i, /מועצה/i, /עיר/i],
  sampleAttrs,
  { preferString: true }
);
const districtField = pickField(
  fields,
  [/district/i, /machoz/i, /מחוז/i, /mahoz/i],
  sampleAttrs,
  { preferString: true }
);
const committeeField = pickField(
  fields,
  [/committee/i, /vaada/i, /ועדה/i, /instit/i, /מוסד/i, /גוף/i],
  sampleAttrs,
  { preferString: true }
);

// Sometimes there's an explicit 'authority level' field; otherwise we can infer from committee text.
const authorityField = pickField(
  fields,
  [/authority/i, /level/i, /סמכות/i, /רמה/i, /סיווג/i, /type/i],
  sampleAttrs,
  { preferString: true }
);

const changedAtIsDate = !!(
  changedAtField && (fields.find((f) => f.name === changedAtField)?.type || "").toLowerCase().includes("date")
);

  return {
    layerUrl,
    fields,
    planNumberField,
    planNameField,
    statusField,
    changedAtField,
    changedAtIsDate,
    cityField,
    districtField,
    committeeField,
    authorityField,
  };
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
function classifyAuthority(committee: string): "local" | "district" | "national" | "unknown" {
  const s = String(committee || "").trim();
  if (!s) return "unknown";
  if (s.includes("מקומית")) return "local";
  if (s.includes("מחוזית")) return "district";
  if (s.includes("ארצית") || s.includes("ות\"ל") || s.includes('ותל') || s.includes("מועצה ארצית")) return "national";
  return "unknown";
}

export async function fetchRecentPlans(opts: {
  queryUrl: string;
  lookbackDays: number;
  pageSize: number;
  maxPages: number;
  overrides?: Partial<{
    planNumberField: string;
    planNameField: string;
    statusField: string;
    changedAtField: string;
    cityField: string;
    districtField: string;
    committeeField: string;
  }>;
}): Promise<{ plans: NormalizedPlan[]; info: any }> {
  const { queryUrl, lookbackDays, pageSize, maxPages, overrides } = opts;

  const discovered = await discoverFields(queryUrl);
  const fields = {
    planNumberField: overrides?.planNumberField ?? discovered.planNumberField,
    planNameField: overrides?.planNameField ?? discovered.planNameField,
    statusField: overrides?.statusField ?? discovered.statusField,
    changedAtField: overrides?.changedAtField ?? discovered.changedAtField,
    cityField: overrides?.cityField ?? discovered.cityField,
    districtField: overrides?.districtField ?? discovered.districtField,
    committeeField: overrides?.committeeField ?? discovered.committeeField,
    authorityField: (overrides as any)?.authorityField ?? (discovered as any).authorityField,
  };

  const changedAtIsDate = !!(
    fields.changedAtField &&
    (discovered.fields.find((f) => f.name === fields.changedAtField)?.type || "").toLowerCase().includes("date")
  );

  const cutoffMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

  const plans: NormalizedPlan[] = [];
  let offset = 0;
  let page = 0;
  let keepGoing = true;

  while (keepGoing && page < maxPages) {
    const params = new URLSearchParams();
    // Reduce payload: if we have a changed-at field, ask only for recently changed records.
// ArcGIS date-time queries should use DATE/TIMESTAMP functions, e.g.:
//   <DateField> >= DATE 'YYYY-MM-DD'  OR  <DateField> >= TIMESTAMP 'YYYY-MM-DD HH:MI:SS'
// Source: Esri guidance on date-time queries.
if (fields.changedAtField) {
  const cutoffDate = new Date(cutoffMs);
  const ymd = cutoffDate.toISOString().slice(0, 10); // UTC YYYY-MM-DD
  params.set("where", `${fields.changedAtField} >= TIMESTAMP '${ymd} 00:00:00'`);
} else {
  params.set("where", "1=1");
}

    params.set("outFields", "*");
    params.set("returnGeometry", "false");
    params.set("f", "json");
    params.set("resultOffset", String(offset));
    params.set("resultRecordCount", String(pageSize));
    if (fields.changedAtField && changedAtIsDate) {
      params.set("orderByFields", `${fields.changedAtField} DESC`);
    }

    const url = `${queryUrl}?${params.toString()}`;
    const res = await fetch(url, { headers: { "User-Agent": "planning-updates-netlify/0.1" } });
    if (!res.ok) throw new Error(`XPLAN query HTTP ${res.status}`);
    const data = await res.json();

    if (data?.error) throw new Error(`XPLAN ArcGIS error: ${JSON.stringify(data.error)}`);

    const feats = Array.isArray(data?.features) ? data.features : [];
    const exceeded = Boolean(data?.exceededTransferLimit);

    for (const f of feats) {
      const attrs = f?.attributes || {};
      const planNumber = safeString(fields.planNumberField ? attrs[fields.planNumberField] : null, "");
      const planName = safeString(fields.planNameField ? attrs[fields.planNameField] : null, "ללא שם");
      const status = safeString(fields.statusField ? attrs[fields.statusField] : null, "עדכון");

      const changedAt = fields.changedAtField ? toIsoMaybe(attrs[fields.changedAtField]) : null;
      const changedAtMs = changedAt ? new Date(changedAt).getTime() : Date.now();

      // Stop condition: once ordered by date, we can stop when older than cutoff
      if (fields.changedAtField && changedAtIsDate && changedAt && changedAtMs < cutoffMs) {
        keepGoing = false;
        break;
      }

      const city = safeString(fields.cityField ? attrs[fields.cityField] : null, "לא צוין");
      const district = safeString(fields.districtField ? attrs[fields.districtField] : null, "לא צוין");
      const committee = safeString(fields.committeeField ? attrs[fields.committeeField] : null, "לא צוין");

      const { statusNorm, changeLabel } = normalizeStatus(status);

      const planId = planNumber || safeString(attrs?.OBJECTID ?? attrs?.objectid ?? attrs?.id, "");
      if (!planId) continue;

      const xplanUrl = planNumber ? `https://ags.iplan.gov.il/xplan/?p1=${encodeURIComponent(planNumber)}` : null;
      const m = extractMavatUrlOrId(attrs, planNumber);
      const mavatUrl = m.mavatUrl || buildMavatUrl(m.mavatId);

      plans.push({
        planId,
        planNumber: planNumber || planId,
        planName,
        city,
        district,
        committee,
        status,
        statusNorm,
        changeLabel,
        changedAt,
        xplanUrl,
        mavatUrl,
        authorityLevel,
        raw: attrs,
      });
    }

    if (!keepGoing) break;

    if (!feats.length || !exceeded) break;
    offset += feats.length;
    page += 1;
  }

  return {
    plans,
    info: {
      discovered: discovered,
      usedFields: { ...fields, changedAtIsDate },
      lookbackDays,
      pageSize,
      maxPages,
      fetchedPlans: plans.length,
    },
  };
}
