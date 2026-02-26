import React, { useMemo, useState, useEffect } from "react";
import { Bell, CheckCircle2, Clock3, Filter, MapPin, Search, Upload, FileText, Sparkles, RefreshCw } from "lucide-react";

// MVP dashboard for planning updates (frontend)
// It tries to load from /api/updates?days=30 (proxied to Netlify Functions).
// If backend isn't ready, it falls back to sample data.

const SAMPLE_UPDATES = [];

const CHANGE_TYPES = [
  { key: "all", label: "הכול" },
  { key: "approved", label: "אושרו" },
  { key: "deposited", label: "הופקדו" },
  { key: "published", label: "פורסמו" },
  { key: "changed", label: "השתנו" },
];

function formatDate(iso) {
  try {
    return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function relativeDaysLabel(days) {
  if (days === 7) return "7 ימים";
  if (days === 30) return "30 ימים";
  if (days === 90) return "90 ימים";
  return `${days} ימים`;
}

function daysAgo(dateIso) {
  const now = Date.now();
  const then = new Date(dateIso).getTime();
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
}

function classForChangeType(type) {
  switch (type) {
    case "approved":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "deposited":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "published":
      return "bg-violet-50 text-violet-700 border-violet-200";
    case "changed":
      return "bg-amber-50 text-amber-700 border-amber-200";
    default:
      return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

function StatCard({ title, value, subtitle, icon: Icon }) {
  return (
    <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-slate-500">{title}</div>
          <div className="text-2xl font-semibold text-slate-900 mt-1">{value}</div>
          {subtitle ? <div className="text-xs text-slate-500 mt-1">{subtitle}</div> : null}
        </div>
        <div className="rounded-xl bg-slate-100 p-2">
          <Icon className="w-5 h-5 text-slate-700" />
        </div>
      </div>
    </div>
  );
}

function UpdateRow({ item, onToggleWatch, watched }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-4 hover:shadow-md transition">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${classForChangeType(item.changeType)}`}>
              {item.changeLabel}
            </span>
            <span className="text-xs text-slate-500">{formatDate(item.changedAt)}</span>
          </div>
          <button
            onClick={() => onToggleWatch(item.id)}
            className={`inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-sm border transition ${
              watched ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
            type="button"
          >
            <Bell className="w-4 h-4" />
            {watched ? "במעקב" : "הוסף למעקב"}
          </button>
        </div>

        <div>
          <div className="text-sm text-slate-500">{item.planNumber}</div>
          <div className="text-lg font-semibold text-slate-900">{item.planName}</div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-600">
          <div className="inline-flex items-center gap-1">
            <MapPin className="w-4 h-4" /> {item.city}
          </div>
          <div>{item.district}</div>
          <div>{item.committee}</div>
          <div className="inline-flex items-center gap-1">
            <FileText className="w-4 h-4" /> {item.status}
          </div>
        </div>

        <div className="text-sm text-slate-700">{item.summary}</div>

        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-slate-500">עודכן לפני {daysAgo(item.changedAt)} ימים</div>
          <a
            href={item.sourceUrl || "#"}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-blue-700 hover:text-blue-900"
            onClick={(e) => {
              if (!item.sourceUrl || item.sourceUrl === "#") e.preventDefault();
            }}
          >
            פתח פרטי תכנית
          </a>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [updates, setUpdates] = useState([]);
  const [sourceMode, setSourceMode] = useState("loading"); // loading | api | sample
  const [activeType, setActiveType] = useState("all");
  const [search, setSearch] = useState("");
  const [daysWindow, setDaysWindow] = useState(30);
  const [districtFilter, setDistrictFilter] = useState("all");
  const [watchlist, setWatchlist] = useState([]);
  const [importError, setImportError] = useState("");
  const [syncMsg, setSyncMsg] = useState("");
  const [apiError, setApiError] = useState("");
  const [selectedLevels, setSelectedLevels] = useState({ local: true, district: true, national: true });

  useEffect(() => {
    try {
      const saved = localStorage.getItem("planning-watchlist");
      if (saved) setWatchlist(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("planning-watchlist", JSON.stringify(watchlist));
    } catch {}
  }, [watchlist]);

  async function refreshFromApi(d = daysWindow) {
    try {
      setSourceMode("loading");
      const res = await fetch(`/api/updates?days=${d}`);
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok) {
        const msg = data?.error ? String(data.error) : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const list = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(list)) throw new Error("Bad API format");
      setApiError("");
      setUpdates(
        list.map((item, i) => ({
          id: item.id || item.plan_id || `api-${i}`,
          planNumber: item.planNumber || item.plan_number || "ללא מספר",
          planName: item.planName || item.plan_name || "ללא שם",
          city: item.city || "לא צוין",
          district: item.district || "לא צוין",
          committee: item.committee || "לא צוין",
          changeType: item.changeType || item.change_type || "changed",
          changeLabel:
            item.changeLabel ||
            ({ approved: "אושרה", deposited: "הופקדה", published: "פורסמה", changed: "עודכנה" }[item.changeType || item.change_type] || "עודכנה"),
          status: item.status || "עדכון",
          changedAt: item.changedAt || item.changed_at || new Date().toISOString(),
          summary: item.summary || "אין תיאור",
          sourceUrl: item.sourceUrl || item.source_url || "#",
        }))
      );
      setSourceMode("api");
    } catch (e) {
      setUpdates([]);
      setSourceMode("error");
      setApiError(e?.message ? String(e.message) : "שגיאה בטעינת נתונים");
    }
  }

  useEffect(() => {
    refreshFromApi(30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const districts = useMemo(() => {
    const values = Array.from(new Set(updates.map((u) => u.district).filter(Boolean)));
    return values.sort((a, b) => a.localeCompare(b, "he"));
  }, [updates]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    return [...updates]
      .filter((u) => {
        const ageMs = now - new Date(u.changedAt).getTime();
        return ageMs <= daysWindow * 24 * 60 * 60 * 1000;
      })
      .filter((u) => (activeType === "all" ? true : u.changeType === activeType))
      .filter((u) => (districtFilter === "all" ? true : u.district === districtFilter))
      .filter((u) => {
        if (!q) return true;
        return [u.planNumber, u.planName, u.city, u.district, u.committee, u.summary]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt));
  }, [updates, activeType, districtFilter, search, daysWindow]);

  const stats = useMemo(() => {
    const inWindow = updates.filter((u) => Date.now() - new Date(u.changedAt).getTime() <= daysWindow * 24 * 60 * 60 * 1000);
    const countByType = (type) => inWindow.filter((u) => u.changeType === type).length;
    return {
      total: inWindow.length,
      approved: countByType("approved"),
      deposited: countByType("deposited"),
      changed: countByType("changed") + countByType("published"),
    };
  }, [updates, daysWindow]);

  function toggleWatch(id) {
    setWatchlist((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleImportJson(file) {
    if (!file) return;
    setImportError("");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "[]"));
        if (!Array.isArray(parsed)) throw new Error("הקובץ חייב להכיל מערך JSON");
        const normalized = parsed.map((item, i) => ({
          id: item.id || `import-${i}`,
          planNumber: item.planNumber || item.plan_number || "ללא מספר",
          planName: item.planName || item.plan_name || "ללא שם",
          city: item.city || "לא צוין",
          district: item.district || "לא צוין",
          committee: item.committee || "לא צוין",
          changeType: item.changeType || item.change_type || "changed",
          changeLabel:
            item.changeLabel ||
            ({ approved: "אושרה", deposited: "הופקדה", published: "פורסמה", changed: "עודכנה" }[item.changeType || item.change_type] || "עודכנה"),
          status: item.status || "עדכון",
          changedAt: item.changedAt || item.changed_at || new Date().toISOString(),
          summary: item.summary || "אין תיאור",
          sourceUrl: item.sourceUrl || item.source_url || "#",
        }));
        setUpdates(normalized);
        setSourceMode("sample");
      } catch (e) {
        setImportError(e?.message || "לא הצלחתי לקרוא את הקובץ");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  async function triggerSync() {
    try {
      setSyncMsg("מרענן נתונים ממנהל התכנון...");
      const levels = Object.entries(selectedLevels).filter(([k,v]) => v).map(([k]) => k);
      if (!levels.length) {
        setSyncMsg("בחר לפחות רמה אחת לסנכרון (מקומית/מחוזית/ארצית)");
        return;
      }
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ levels }),
      });
      let data = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }
      if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
      setSyncMsg(`סנכרון הסתיים: ${data?.fetched ?? "?"} רשומות, ${data?.newEvents ?? "?"} אירועים חדשים`);
      await refreshFromApi(daysWindow);
    } catch (e) {
      setSyncMsg(`סנכרון נכשל: ${e?.message || e}`);
    } finally {
      setTimeout(() => setSyncMsg(""), 8000);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8" dir="rtl">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="rounded-3xl bg-white border border-slate-200 shadow-sm p-5 md:p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 text-blue-700 px-3 py-1 text-sm font-medium">
                <Sparkles className="w-4 h-4" />
                דשבורד עדכוני תכנון
              </div>
              <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mt-3">רשימת תכניות שהשתנו לאחרונה</h1>
              <p className="text-slate-600 mt-2 text-sm md:text-base">
                מציג תכניות שאושרו, הופקדו, פורסמו או עודכנו לאחרונה — עם סינון פשוט וחיפוש.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border px-2 py-1 bg-slate-50 text-slate-700 border-slate-200">מקור נתונים: XPLAN (מנהל התכנון)</span>
                {sourceMode === "loading" && <span className="rounded-full border px-2 py-1 bg-blue-50 text-blue-700 border-blue-200">טוען נתונים...</span>}
                {sourceMode === "api" && <span className="rounded-full border px-2 py-1 bg-emerald-50 text-emerald-700 border-emerald-200">מחובר ל-API</span>}
                {sourceMode === "sample" && <span className="rounded-full border px-2 py-1 bg-amber-50 text-amber-700 border-amber-200">מצב דוגמה (לא בשימוש)</span>}
                {sourceMode === "error" && <span className="rounded-full border px-2 py-1 bg-rose-50 text-rose-700 border-rose-200">סנכרון נכשל</span>}
              </div>
              {syncMsg ? <div className="mt-2 text-sm text-slate-700">{syncMsg}</div> : null}
              {apiError ? <div className="mt-2 text-sm text-rose-700">{apiError}</div> : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={triggerSync}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
              >
                <RefreshCw className="w-4 h-4" />
                סנכרן עכשיו
              </button>

<div className="flex flex-wrap items-center gap-2 mr-2">
  <span className="text-xs text-slate-500">רמת סמכות:</span>
  {[
    ["local", "מקומית"],
    ["district", "מחוזית"],
    ["national", "ארצית"],
  ].map(([key, label]) => (
    <label key={key} className="inline-flex items-center gap-1 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={selectedLevels[key]}
        onChange={(e) => setSelectedLevels((prev) => ({ ...prev, [key]: e.target.checked }))}
      />
      <span className="text-xs">{label}</span>
    </label>
  ))}
</div>

</div>
          </div>
          {importError ? <div className="mt-3 text-sm text-rose-700">{importError}</div> : null}
        </header>

        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard title="סה״כ עדכונים" value={stats.total} subtitle={`בטווח ${relativeDaysLabel(daysWindow)}`} icon={Clock3} />
          <StatCard title="אושרו" value={stats.approved} subtitle="שינויי סטטוס לאישור" icon={CheckCircle2} />
          <StatCard title="הופקדו" value={stats.deposited} subtitle="תכניות בהפקדה" icon={FileText} />
          <StatCard title="במעקב" value={watchlist.length} subtitle="תכניות שסימנת" icon={Bell} />
        </section>

        <section className="rounded-3xl bg-white border border-slate-200 shadow-sm p-4 md:p-5 space-y-4">
          <div className="flex items-center gap-2 text-slate-800 font-medium">
            <Filter className="w-4 h-4" /> פילטרים
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-5 relative">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש לפי מספר תכנית, שם, עיר, ועדה..."
                className="w-full rounded-2xl border border-slate-200 bg-white pr-9 pl-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <div className="lg:col-span-3">
              <select
                value={districtFilter}
                onChange={(e) => setDistrictFilter(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                <option value="all">כל המחוזות</option>
                {districts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-4 flex flex-wrap items-center gap-2">
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setDaysWindow(d);
                    refreshFromApi(d);
                  }}
                  className={`rounded-2xl px-3 py-2 text-sm border transition ${
                    daysWindow === d ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {relativeDaysLabel(d)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {CHANGE_TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveType(t.key)}
                className={`rounded-full px-4 py-2 text-sm border transition ${
                  activeType === t.key ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm text-slate-600">נמצאו {filtered.length} תכניות</div>
            {activeType !== "all" && (
              <button type="button" onClick={() => setActiveType("all")} className="text-sm text-blue-700 hover:text-blue-900">
                נקה סינון סוג שינוי
              </button>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
              לא נמצאו תוצאות בהתאם לסינון. נסה להרחיב טווח ימים או לנקות פילטרים.
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {filtered.map((item) => (
                <UpdateRow key={item.id} item={item} onToggleWatch={toggleWatch} watched={watchlist.includes(item.id)} />
              ))}
            </div>
          )}
        </section>

        <footer className="text-xs text-slate-500 text-center py-2">
          Frontend על Netlify + Netlify Functions + Netlify Blobs (נתוני אמת ממנהל התכנון).
        </footer>
      </div>
    </div>
  );
}
