/* Content OS · Admin — data layer (reusable across every screen).
 * The ONLY place that talks to the backend: PostgREST (db), edge functions (fn),
 * and the static catalog JSONs (loadCatalog). Auth headers live here once.
 */

export const CFG = window.CONTENT_OS_CONFIG || {};
export const REST = (CFG.SUPABASE_URL || "").replace(/\/$/, "") + "/rest/v1";

const HEAD = {
  apikey: CFG.SUPABASE_KEY || "",
  Authorization: "Bearer " + (CFG.SUPABASE_KEY || ""),
  "Content-Type": "application/json",
};

// Shared request core: fetch with the auth headers, read text, tolerant-parse JSON.
// db() and fn() layer their own error semantics on top of the same pipeline.
export async function http(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...HEAD, ...(opts.headers || {}) } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { res, text, json };
}

// PostgREST call: throws on non-2xx with the body as the message.
export async function db(path, opts = {}) {
  const { res, text, json } = await http(REST + path, opts);
  if (!res.ok) throw new Error(text || res.status);
  return json;
}

export const fnUrl = (name) => (CFG.SUPABASE_URL || "").replace(/\/$/, "") + "/functions/v1/" + name;

// Edge-function POST. A 2xx that isn't JSON is a broken proxy/gateway, not a
// success — never return null (callers dereference the result immediately).
export async function fn(name, body) {
  const { res, text, json } = await http(fnUrl(name), { method: "POST", body: JSON.stringify(body) });
  if (!json) throw new Error(`${res.status}: ${(text || "empty response").slice(0, 200)}`);
  if (json.ok === false && json.error) throw new Error(json.error);
  return json;
}

// Paged PostgREST read: returns { rows, total }. Total comes from the
// Content-Range header (Prefer: count=exact), so pagers can show "page X of N".
export async function dbPaged(path, page, size) {
  const offset = page * size;
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(REST + path + `${sep}limit=${size}&offset=${offset}`, {
    headers: { ...HEAD, Prefer: "count=exact" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || res.status);
  const cr = res.headers.get("content-range") || "*/0"; // e.g. "0-9/247"
  const total = Number(cr.split("/")[1]) || 0;
  return { rows: JSON.parse(text || "[]"), total };
}

// The catalog JSONs are static per session (they change on edit/deploy, not at
// runtime) — fetch each once and cache; reload the page to pick up a new deploy.
const catalogCache = new Map();
export async function loadCatalog(path) {
  if (!catalogCache.has(path)) {
    const res = await fetch(path);
    if (!res.ok) throw new Error("catalog fetch " + res.status);
    catalogCache.set(path, await res.json());
  }
  return catalogCache.get(path);
}
