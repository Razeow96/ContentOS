/* Infrastructure › Rate-limit — the whole ecosystem's outbound-call ledger
 * (api_request_log), live. One combined table: each call, plus that provider's
 * day usage (request) and month usage (per-month budget = daily cap × 30).
 * Filters: denied-only · today | history · date range (apply on Submit).
 * 10 rows per page with a pager; live auto-refresh repaints only the table.
 */

import { db, dbPaged } from "../../lib/api.js";
import { $, esc, table, pagedBody, pageHeader } from "../../lib/ui.js";
import { isActive } from "../../lib/nav.js";
import { onInserts } from "../../lib/realtime.js";

const SIZE = 10;
const DAYS_PER_MONTH = 30; // per owner: monthly cap = daily cap × 30

const S = { mode: "today", denied: false, from: "", to: "", page: 0, total: 0 };
let unsub = null;

const todayStr = () => new Date().toISOString().slice(0, 10);
const monthStart = () => todayStr().slice(0, 8) + "01";

function query() {
  let q = `/api_request_log?select=*&order=requested_at.desc`;
  if (S.denied) q += `&allowed=eq.false`;
  if (S.mode === "today") {
    const d = todayStr();
    q += `&requested_at=gte.${d}T00:00:00&requested_at=lte.${d}T23:59:59`;
  } else {
    if (S.from) q += `&requested_at=gte.${S.from}T00:00:00`;
    if (S.to) q += `&requested_at=lte.${S.to}T23:59:59`;
  }
  return q;
}

// Per-provider day + month usage, for the request / per-month budget columns.
async function usage() {
  const [limits, dayC, monthC] = await Promise.all([
    db("/api_rate_limits?select=provider,max_requests_per_day").catch(() => []),
    db(`/api_usage_counters?select=provider,requests&day=eq.${todayStr()}`).catch(() => []),
    db(`/api_usage_counters?select=provider,requests&day=gte.${monthStart()}`).catch(() => []),
  ]);
  const cap = Object.fromEntries((limits || []).map((l) => [l.provider, l.max_requests_per_day]));
  const day = Object.fromEntries((dayC || []).map((c) => [c.provider, c.requests]));
  const month = {};
  for (const c of monthC || []) month[c.provider] = (month[c.provider] || 0) + c.requests;
  return { cap, day, month };
}

export async function render() {
  $("#screen").innerHTML = pageHeader("Infrastructure › Rate-limit",
    `Ecosystem-wide <span class="mono">api_request_log</span> — every outbound call + its provider's day and month spend, live (RAZ-42).`) +
    `<div class="card">
      <div class="spread">
        <h2>Ledger <span class="count live" id="rlcount">·</span></h2>
        <div class="row">
          <label class="check"><input type="checkbox" id="rldenied" ${S.denied ? "checked" : ""}> denied only</label>
          <select id="rlmode">
            <option value="today" ${S.mode === "today" ? "selected" : ""}>today</option>
            <option value="history" ${S.mode === "history" ? "selected" : ""}>history</option>
          </select>
          <label class="check">from&nbsp;<input type="date" id="rlfrom" value="${S.from}"></label>
          <label class="check">to&nbsp;<input type="date" id="rlto" value="${S.to}"></label>
          <button class="btn" id="rlsubmit">Submit</button>
        </div>
      </div>
      <div class="cardhint"><span class="mono">request</span> = today's calls / daily cap · <span class="mono">per-month budget</span> = this month's calls / (daily cap × ${DAYS_PER_MONTH})</div>
      <div id="rltable"><p class="hint">loading…</p></div>
    </div>`;

  $("#rlsubmit").addEventListener("click", () => {
    S.denied = $("#rldenied").checked;
    S.mode = $("#rlmode").value;
    S.from = $("#rlfrom").value;
    S.to = $("#rlto").value;
    S.page = 0;
    refresh();
  });

  await refresh();
  scheduleLive();
}

async function refresh() {
  let rows = [], total = 0, u = { cap: {}, day: {}, month: {} };
  try {
    [{ rows, total }, u] = await Promise.all([dbPaged(query(), S.page, SIZE), usage()]);
  } catch (e) {
    if (!isActive("ratelimit")) return;
    $("#rltable").innerHTML = `<p class="hint mono">rate-limit tables unavailable: ${esc(e.message).slice(0, 160)}</p>`;
    return;
  }
  if (!isActive("ratelimit")) return;
  S.total = total;
  const cnt = $("#rlcount"); if (cnt) cnt.textContent = total;

  const budget = (n, max) => (max === null || max === undefined) ? "—" : `${n ?? 0}/${max}`;
  const cols = ["Date", "Time", "Provider", "Request", "Per-month budget", "Method", "Status", "URL / denied reason"];
  const rowsArr = rows.map((r) => {
    const p = r.provider;
    const cap = u.cap[p];
    return `<tr>
      <td class="mono">${esc(String(r.requested_at || "").slice(0, 10))}</td>
      <td class="mono">${esc(String(r.requested_at || "").slice(11, 19))}</td>
      <td class="mono">${esc(p)}</td>
      <td class="mono">${budget(u.day[p], cap)}</td>
      <td class="mono">${budget(u.month[p], cap == null ? null : cap * DAYS_PER_MONTH)}</td>
      <td class="mono">${esc(r.method)}</td>
      <td><span class="tag ${r.allowed ? "on" : "warn"}">${r.allowed ? (r.status ?? "✓") : "DENIED"}</span></td>
      <td class="mono" style="max-width:300px;overflow:hidden;text-overflow:ellipsis">${esc(r.deny_reason || r.url || "")}</td>
    </tr>`;
  });

  $("#rltable").innerHTML =
    table(cols, pagedBody(cols.length, rowsArr, "No calls in this window.", SIZE)) + pager();
  wirePager();
}

function pager() {
  const pages = Math.max(1, Math.ceil(S.total / SIZE));
  const cur = S.page + 1;
  return `<div class="pager">
    <span class="hint">page ${cur} of ${pages} · ${S.total} row${S.total === 1 ? "" : "s"}</span>
    <div class="row">
      <button class="btn ghost" id="rlprev" ${S.page <= 0 ? "disabled" : ""}>Prev</button>
      <button class="btn ghost" id="rlnext" ${cur >= pages ? "disabled" : ""}>Next</button>
    </div>
  </div>`;
}

function wirePager() {
  $("#rlprev")?.addEventListener("click", () => { if (S.page > 0) { S.page--; refresh(); } });
  $("#rlnext")?.addEventListener("click", () => { if ((S.page + 1) * SIZE < S.total) { S.page++; refresh(); } });
}

// Live: true push. A new api_request_log INSERT refreshes the newest page (which
// also re-reads the day/month usage counters). Paused while paginated back.
function scheduleLive() {
  if (unsub) { unsub(); unsub = null; }
  unsub = onInserts("api_request_log", () => {
    if (!isActive("ratelimit")) { if (unsub) { unsub(); unsub = null; } return; }
    if (S.page === 0) refresh();
  });
}
