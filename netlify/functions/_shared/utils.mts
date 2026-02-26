import { createHash } from "node:crypto";

export function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

export function safeString(v: any, fallback = "") {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length ? s : fallback;
}

export function toIsoMaybe(v: any): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    // ArcGIS dates are often epoch milliseconds
    const ms = v > 10_000_000_000 ? v : v * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof v === "string") {
    const s = v.trim();
    // If it's already ISO-ish, return it
    if (/\d{4}-\d{2}-\d{2}T/.test(s)) return s;
    return s;
  }
  return String(v);
}

export function utcDayKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function daysBackKeys(days: number) {
  const keys: string[] = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const dt = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    keys.push(utcDayKey(dt));
  }
  return keys;
}
