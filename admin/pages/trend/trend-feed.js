/* Trend › Trend-feed — the emitted TrendDetected stream (trend_events), live.
 * One row per event, newest first: when it fired, which campaign + platform, the
 * topic, its raw volume, the signal type, and the correlation id that traces the
 * flow across domains. Volume is shown as-is {value unit} — NEVER compared across
 * platforms (views ≠ searches ≠ likes). 10 rows/page + pager; true-push live.
 */

import { dbPaged } from "../../lib/api.js";
import { $, esc, table, pagedBody, pageHeader } from "../../lib/ui.js";
import { isActive } from "../../lib/nav.js";
import { onInserts } from "../../lib/realtime.js";

const SIZE = 10;
const S = { page: 0, total: 0 };
let unsub = null;

// Pull only the payload fields the table shows (not the fat `raw`) — 10 rows stays light.
const QUERY = "/trend_events?select=event_id,occurred_at,correlation_id," +
  "topic:payload->>topic,platform:payload->>source,signal:payload->>signal_type," +
  "campaign:payload->>campaign,volume:payload->volume&order=occurred_at.desc";

function volCell(v) {
  if (!v || v.value === null || v.value === undefined) return "—";
  return `${esc(v.value)} ${esc(v.unit || "")}`.trim();
}

export async function render() {
  $("#screen").innerHTML = pageHeader("Trend › Trend-feed",
    `Emitted <span class="mono">TrendDetected</span> events — every detected signal fanned out to a subscribing page. Volume is raw {value unit}; never compared across platforms.`) +
    `<div class="card">
      <div class="spread">
        <h2>Feed <span class="count live" id="tfcount">·</span></h2>
      </div>
      <div class="cardhint">Populated on each <span class="mono">m1-trend</span> run — the daily trigger is intentionally off, so the feed grows on manual runs.</div>
      <div id="tftable"><p class="hint">loading…</p></div>
    </div>`;

  await refresh();
  scheduleLive();
}

async function refresh() {
  let rows = [], total = 0;
  try {
    ({ rows, total } = await dbPaged(QUERY, S.page, SIZE));
  } catch (e) {
    if (!isActive("trend-feed")) return;
    $("#tftable").innerHTML = `<p class="hint mono">trend_events unavailable: ${esc(e.message).slice(0, 160)}</p>`;
    return;
  }
  if (!isActive("trend-feed")) return;
  S.total = total;
  const cnt = $("#tfcount"); if (cnt) cnt.textContent = total;

  const cols = ["Occurred", "Campaign", "Platform", "Topic", "Volume", "Signal", "Correlation"];
  const rowsArr = rows.map((r) => `<tr>
    <td class="mono">${esc(String(r.occurred_at || "").slice(0, 19).replace("T", " "))}</td>
    <td class="mono">${r.campaign ? esc(r.campaign) : "—"}</td>
    <td class="mono">${esc(r.platform || "—")}</td>
    <td class="mono" style="max-width:320px;overflow:hidden;text-overflow:ellipsis">${esc(r.topic || "")}</td>
    <td class="mono">${volCell(r.volume)}</td>
    <td>${r.signal ? `<span class="tag">${esc(r.signal)}</span>` : "—"}</td>
    <td class="mono" title="${esc(r.correlation_id || "")}">${esc(String(r.correlation_id || "").slice(0, 8))}…</td>
  </tr>`);

  $("#tftable").innerHTML =
    table(cols, pagedBody(cols.length, rowsArr, "No trends emitted yet.", SIZE)) + pager();
  wirePager();
}

function pager() {
  const pages = Math.max(1, Math.ceil(S.total / SIZE));
  const cur = S.page + 1;
  return `<div class="pager">
    <span class="hint">page ${cur} of ${pages} · ${S.total} event${S.total === 1 ? "" : "s"}</span>
    <div class="row">
      <button class="btn ghost" id="tfprev" ${S.page <= 0 ? "disabled" : ""}>Prev</button>
      <button class="btn ghost" id="tfnext" ${cur >= pages ? "disabled" : ""}>Next</button>
    </div>
  </div>`;
}

function wirePager() {
  $("#tfprev")?.addEventListener("click", () => { if (S.page > 0) { S.page--; refresh(); } });
  $("#tfnext")?.addEventListener("click", () => { if ((S.page + 1) * SIZE < S.total) { S.page++; refresh(); } });
}

// Live: a new trend_events INSERT refreshes the newest page (paused while paged back).
function scheduleLive() {
  if (unsub) { unsub(); unsub = null; }
  unsub = onInserts("trend_events", () => {
    if (!isActive("trend-feed")) { if (unsub) { unsub(); unsub = null; } return; }
    if (S.page === 0) refresh();
  });
}
