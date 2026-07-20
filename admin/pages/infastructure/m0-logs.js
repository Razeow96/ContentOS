/* Infrastructure › Logs — the whole ecosystem's run_log (every domain's
 * invocations), live. Filter by source + date range (apply on Submit), 10 rows
 * per page with a pager, and a live auto-refresh that repaints only the table
 * (so it never clobbers the filter inputs) while you're on the newest page.
 */

import { db, dbPaged } from "../../lib/api.js";
import { $, esc, table, pagedBody, pageHeader } from "../../lib/ui.js";
import { isActive } from "../../lib/nav.js";
import { onInserts } from "../../lib/realtime.js";

const SIZE = 10;

const S = { source: "", from: "", to: "", page: 0, total: 0, sources: [], loaded: false };
let unsub = null;

function statusBadge(st) {
  const m = { ok: ["on", "✓ ok"], skip: ["", "skip"], error: ["warn", "✕ error"], crashed: ["warn", "✕ crash"], started: ["", "…running"] };
  const [cls, txt] = m[st] || ["", st];
  return `<span class="tag ${cls}">${txt}</span>`;
}

function query() {
  let q = `/run_log?select=*&order=started_at.desc`;
  if (S.source) q += `&source=eq.${encodeURIComponent(S.source)}`;
  if (S.from) q += `&started_at=gte.${S.from}T00:00:00`;
  if (S.to) q += `&started_at=lte.${S.to}T23:59:59`;
  return q;
}

export async function render() {
  // Source dropdown is stable per session — load once.
  if (!S.loaded) {
    const s = await db("/run_log?select=source&order=source.asc&limit=1000").catch(() => []);
    S.sources = [...new Set((s || []).map((r) => r.source))];
    S.loaded = true;
  }
  $("#screen").innerHTML = pageHeader("Infrastructure › Logs",
    `Ecosystem-wide <span class="mono">run_log</span> — every invocation across all domains, live (RAZ-58).`) +
    `<div class="card">
      <div class="spread">
        <h2>Logs <span class="count live" id="lgcount">·</span></h2>
        <div class="row">
          <select id="lgsource"><option value="">all sources</option>
            ${S.sources.map((s) => `<option value="${esc(s)}" ${S.source === s ? "selected" : ""}>${esc(s)}</option>`).join("")}
          </select>
          <label class="check">from&nbsp;<input type="date" id="lgfrom" value="${S.from}"></label>
          <label class="check">to&nbsp;<input type="date" id="lgto" value="${S.to}"></label>
          <button class="btn" id="lgsubmit">Submit</button>
        </div>
      </div>
      <div class="cardhint"></div>
      <div id="lgtable"><p class="hint">loading…</p></div>
    </div>`;

  $("#lgsubmit").addEventListener("click", () => {
    S.source = $("#lgsource").value;
    S.from = $("#lgfrom").value;
    S.to = $("#lgto").value;
    S.page = 0;
    refresh();
  });

  await refresh();
  scheduleLive();
}

// Repaints ONLY #lgtable — leaves the filter inputs untouched so a live tick
// never resets a half-typed date.
async function refresh() {
  let rows = [], total = 0;
  try {
    ({ rows, total } = await dbPaged(query(), S.page, SIZE));
  } catch (e) {
    if (!isActive("logs")) return;
    $("#lgtable").innerHTML = `<p class="hint mono">run_log unavailable: ${esc(e.message).slice(0, 160)}</p>`;
    return;
  }
  if (!isActive("logs")) return;
  S.total = total;
  const cnt = $("#lgcount"); if (cnt) cnt.textContent = total;

  const cols = ["Date", "Time", "Status", "IP", "Source", "Note"];
  const rowsArr = rows.map((r) => `<tr>
      <td class="mono">${esc(String(r.started_at || "").slice(0, 10))}</td>
      <td class="mono">${esc(String(r.started_at || "").slice(11, 19))}</td>
      <td>${statusBadge(r.status)}</td>
      <td class="mono">${esc(r.caller_ip ?? "—")}</td>
      <td class="mono">${esc(r.source)}</td>
      <td class="mono" style="max-width:360px;overflow:hidden;text-overflow:ellipsis">${esc(r.note ?? "")}</td>
    </tr>`);

  $("#lgtable").innerHTML =
    table(cols, pagedBody(cols.length, rowsArr, "No logs in this window.", SIZE)) + pager();
  wirePager();
}

function pager() {
  const pages = Math.max(1, Math.ceil(S.total / SIZE));
  const cur = S.page + 1;
  return `<div class="pager">
    <span class="hint">page ${cur} of ${pages} · ${S.total} row${S.total === 1 ? "" : "s"}</span>
    <div class="row">
      <button class="btn ghost" id="lgprev" ${S.page <= 0 ? "disabled" : ""}>Prev</button>
      <button class="btn ghost" id="lgnext" ${cur >= pages ? "disabled" : ""}>Next</button>
    </div>
  </div>`;
}

function wirePager() {
  $("#lgprev")?.addEventListener("click", () => { if (S.page > 0) { S.page--; refresh(); } });
  $("#lgnext")?.addEventListener("click", () => { if ((S.page + 1) * SIZE < S.total) { S.page++; refresh(); } });
}

// Live: true push. A new run_log INSERT refreshes the newest page. Paused while
// paginated back (browsing history should stay stable), and unsubscribes on leave.
function scheduleLive() {
  if (unsub) { unsub(); unsub = null; }
  unsub = onInserts("run_log", () => {
    if (!isActive("logs")) { if (unsub) { unsub(); unsub = null; } return; }
    if (S.page === 0) refresh();
  });
}
