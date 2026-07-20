/* Content Source screen (M2 · manual keyword search + review · RAZ-37/40).
 * TWO PANELS, because the two halves run on different clocks:
 *   Panel A "Search"  — sync sources (TMDB + the 5 AI-search scrapers, 19-78s) answer inline.
 *   Panel B "Review"  — the queue over manual_search_results. Async keyword DISCOVERY
 *                       (bd_youtube_search, minutes) can ONLY land here, never inline.
 * Nothing reaches source_events from here except via Promote — the one explicit human step.
 */

import { db, fn, loadCatalog, CFG } from "../lib/api.js";
import { $, esc, fmtTs, table, toast } from "../lib/ui.js";
import { isActive } from "../lib/nav.js";

const SOURCE_CATALOG = "../supabase/functions/m2-contentsource/sources.json";

const src = {
  catalog: [],       // search-capable entries from the DEPLOYED sources.json
  picked: new Set(), // source names ticked in panel A
  videoType: "",     // "" = both | "Video" | "Shorts"
  keyword: "",
  aiAssist: false,
  busy: false,       // search in flight
  opBusy: false,     // promote/discard in flight — a double-click would double-emit events
  queue: [],         // manual_search_results status=new
  chosen: new Set(), // queue row ids ticked in panel B
  pages: [],         // page_source_settings
  promoteTo: "",
  lastRun: null,
};

// A source is ASYNC when it is a Bright Data keyword-DISCOVERY job — the same predicate
// the backend's buildSearchPlan uses (type=brightdata + bd_input=keyword). Discovery
// cannot answer inside the function's sync budget (measured: 112.6s, 0 records) and
// must go via search_plan -> n8n.
const isAsync = (s) => s.type === "brightdata" && s.bd_input === "keyword";

async function load() {
  const cat = await loadCatalog(SOURCE_CATALOG);
  // The DEPLOYED catalog is the truth — never a second copy of the source list here.
  src.catalog = (cat.sources || []).filter((s) => s && s.name && s.enabled && s.search === true);
  const [queue, pages] = await Promise.all([
    db("/manual_search_results?select=id,keyword,source,material_type,external_id,ai_assisted,status,payload,searched_at&status=eq.new&order=id.desc&limit=200").catch(() => []),
    db("/page_source_settings?select=page_id,sources_enabled&order=page_id.asc").catch(() => []),
  ]);
  src.queue = queue || [];
  src.pages = pages || [];
  if (!src.promoteTo) {
    const on = src.pages.find((p) => p.sources_enabled);
    src.promoteTo = on ? on.page_id : "";
  }
}

// Entry point the router calls: lazy-load then paint, with the load-error fallback.
export async function show() {
  try {
    await load();
    if (isActive("source")) render();
  } catch (e) {
    if (!isActive("source")) return;
    $("#screen").innerHTML = `<h1>Content Source</h1><div class="card"><h2>Could not load</h2>
      <p class="hint mono">${esc(e.message).slice(0, 240)}</p>
      <p class="hint">The catalog is fetched from <span class="mono">${esc(SOURCE_CATALOG)}</span> — serve from the REPO ROOT, not from inside /admin.</p></div>`;
  }
}

function render() {
  const ai = src.catalog.filter((s) => s.bd_input === "prompt");
  const free = src.catalog.filter((s) => s.type !== "brightdata");
  const disc = src.catalog.filter(isAsync);
  const anyAsync = [...src.picked].some((n) => disc.some((d) => d.name === n));

  const box = (s, note) => `<label class="check" title="${esc(s.notes || "").slice(0, 160)}">
      <input type="checkbox" class="srcpick" value="${esc(s.name)}" ${src.picked.has(s.name) ? "checked" : ""}>
      ${esc(s.name)}${note ? ` <span class="tag">${note}</span>` : ""}</label>`;

  const q = src.queue;
  const byKw = new Map();
  for (const r of q) byKw.set(r.keyword, (byKw.get(r.keyword) || 0) + 1);

  $("#screen").innerHTML = `<h1>Content Source</h1>
    <p class="sub">M2 · manual keyword search (RAZ-37). Results are ISOLATED — nothing reaches the event stream until you Promote.</p>

    <div class="card">
      <h2>Search</h2>
      <p class="hint">Free + AI sources answer inline (~19–78s). Bright Data keyword discovery is a <em>discover</em> job — it runs async via n8n and lands in the queue below minutes later, never inline.</p>
      <div class="row" style="margin-bottom:10px">
        <input id="skw" placeholder="keyword…" value="${esc(src.keyword)}" style="min-width:280px">
        <label class="check"><input type="checkbox" id="sai" ${src.aiAssist ? "checked" : ""}> AI-assist match</label>
        <button class="btn" id="sgo" ${src.busy ? "disabled" : ""}>${src.busy ? "Searching…" : "Search"}</button>
      </div>

      <div class="row" style="align-items:flex-start;gap:22px;flex-wrap:wrap">
        <div><div class="hint" style="margin-bottom:4px">Free</div>${free.map((s) => box(s)).join("") || '<span class="hint">none</span>'}</div>
        <div><div class="hint" style="margin-bottom:4px">AI answer <span class="tag">paid · sync</span></div>${ai.map((s) => box(s)).join("") || '<span class="hint">none</span>'}</div>
        <div><div class="hint" style="margin-bottom:4px">Keyword discovery <span class="tag warn">paid · async</span></div>${disc.map((s) => box(s, "async")).join("") || '<span class="hint">none</span>'}</div>
      </div>

      ${disc.length && anyAsync ? `<div class="row" style="margin-top:10px">
        <span class="hint">video type</span>
        <select id="svt">
          <option value="" ${src.videoType === "" ? "selected" : ""}>both (video + shorts)</option>
          <option value="Video" ${src.videoType === "Video" ? "selected" : ""}>Video only (long-form)</option>
          <option value="Shorts" ${src.videoType === "Shorts" ? "selected" : ""}>Shorts only</option>
        </select>
        <span class="hint">capped at 10 records per search</span>
      </div>` : ""}

      ${src.lastRun ? `<p class="hint" style="margin-top:10px">${esc(src.lastRun)}</p>` : ""}
    </div>

    <div class="card">
      <div class="spread">
        <h2>Review queue <span class="count ${q.length ? "live" : ""}">${q.length} new</span></h2>
        <div class="row">
          <span class="hint">promote to page</span>
          <select id="spage">
            ${src.pages.map((p) => `<option value="${esc(p.page_id)}" ${src.promoteTo === p.page_id ? "selected" : ""} ${p.sources_enabled ? "" : "disabled"}>${esc(p.page_id)}${p.sources_enabled ? "" : " (gated off)"}</option>`).join("")}
          </select>
          <button class="btn" id="spromote" ${src.chosen.size && src.promoteTo ? "" : "disabled"}>Promote ${src.chosen.size || ""}</button>
          <button class="btn ghost" id="sdiscard" ${src.chosen.size ? "" : "disabled"}>Discard</button>
          <button class="btn ghost" id="srefresh">Refresh</button>
        </div>
      </div>
      <p class="hint">Promote emits a real SourceEnriched into <span class="mono">source_events</span> (fresh correlation_id, causation_id null) and flips the row to <span class="mono">promoted</span> — the only bridge out of this store. Discard keeps the row as a record of what you rejected; it emits nothing.</p>
      ${byKw.size ? `<p class="hint">${[...byKw].map(([k, n]) => `<span class="tag">${esc(k)} · ${n}</span>`).join(" ")}</p>` : ""}
      ${
      table(
        [{ h: '<input type="checkbox" id="sall">', w: "28px" }, "Title", "Source", "Engagement", "Found", "Link"],
        q.map((r) => {
          const p = r.payload || {};
          const e = p.engagement || null;
          const eng = e ? Object.entries(e).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k[0]}:${v}`).join(" ") : "—";
          return `<tr>
            <td><input type="checkbox" class="qpick" value="${r.id}" ${src.chosen.has(r.id) ? "checked" : ""}></td>
            <td><div class="qcell">${p.image_url ? `<img class="thumb" src="${esc(p.image_url)}" alt="">` : ""}<span class="qtitle">${esc(String(p.title || "").slice(0, 78))}</span></div></td>
            <td class="mono">${esc(r.source)}${p.kind ? ` <span class="tag">${esc(p.kind)}</span>` : ""}</td>
            <td class="mono">${esc(eng)}</td>
            <td class="mono">${esc(fmtTs(r.searched_at, 5, 16))}</td>
            <td>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">open</a>` : "—"}</td>
          </tr>`;
        }).join(""),
        "Nothing waiting. Search above — results land here.",
      )
    }
    </div>`;

  /* --- panel A wiring --- */
  $("#skw").addEventListener("input", (e) => { src.keyword = e.target.value; });
  $("#sai").addEventListener("change", (e) => { src.aiAssist = e.target.checked; });
  const vt = $("#svt");
  if (vt) vt.addEventListener("change", (e) => { src.videoType = e.target.value; });
  document.querySelectorAll(".srcpick").forEach((c) =>
    c.addEventListener("change", (e) => {
      e.target.checked ? src.picked.add(e.target.value) : src.picked.delete(e.target.value);
      // Full re-render only when the video-type row must appear/disappear — a plain
      // tick otherwise rebuilt the whole screen (and its 200-row queue) per click.
      const wantToggle = [...src.picked].some((n) => disc.some((d) => d.name === n));
      if (wantToggle !== !!$("#svt")) render();
    })
  );
  $("#sgo").addEventListener("click", runSearch);

  /* --- panel B wiring --- */
  const syncQueueButtons = () => {
    const p = $("#spromote"), d = $("#sdiscard");
    if (p) {
      p.disabled = !(src.chosen.size && src.promoteTo) || src.opBusy;
      p.textContent = "Promote" + (src.chosen.size ? " " + src.chosen.size : "");
    }
    if (d) d.disabled = !src.chosen.size || src.opBusy;
  };
  $("#sall").addEventListener("change", (e) => {
    src.chosen = e.target.checked ? new Set(q.map((r) => r.id)) : new Set();
    document.querySelectorAll(".qpick").forEach((c) => (c.checked = e.target.checked));
    syncQueueButtons();
  });
  document.querySelectorAll(".qpick").forEach((c) =>
    c.addEventListener("change", (e) => {
      const id = Number(e.target.value);
      e.target.checked ? src.chosen.add(id) : src.chosen.delete(id);
      syncQueueButtons();
    })
  );
  $("#spage").addEventListener("change", (e) => { src.promoteTo = e.target.value; syncQueueButtons(); });
  $("#spromote").addEventListener("click", doPromote);
  $("#sdiscard").addEventListener("click", doDiscard);
  $("#srefresh").addEventListener("click", () => refreshSource().catch((e) => toast("Refresh failed: " + e.message, true)));
}

// Reload the source-screen data and repaint — but only if the operator is still ON the
// source screen; a slow response must never repaint over another screen.
async function refreshSource() {
  await load();
  if (isActive("source")) render();
}

async function runSearch() {
  const kw = (src.keyword || "").trim();
  if (!kw) return toast("Enter a keyword", true);
  if (!src.picked.size) return toast("Pick at least one source", true);

  const names = [...src.picked];
  const asyncNames = names.filter((n) => src.catalog.some((s) => s.name === n && isAsync(s)));
  const syncNames = names.filter((n) => !asyncNames.includes(n));

  src.busy = true; src.lastRun = null; render();
  const notes = [];
  try {
    // Sync half: answers inline, writes straight to the queue (sink=manual).
    if (syncNames.length) {
      const r = await fn("m2-contentsource", { mode: "search", keyword: kw, sources: syncNames, sink: "manual", ai_assist: src.aiAssist });
      notes.push(`sync: ${r.written} result(s) from ${(r.sources || []).join(", ") || "—"}`);
      if (r.errors && r.errors.length) notes.push(`errors: ${r.errors.join(" | ")}`);
    }
    // Async half: search_plan only PLANS. n8n runs the slow trigger->poll->download->ingest.
    if (asyncNames.length) {
      const plan = await fn("m2-contentsource", {
        mode: "search_plan", keyword: kw, sources: asyncNames,
        video_type: src.videoType || null, sink: "manual", ai_assist: src.aiAssist,
      });
      const jobs = plan.jobs || [];
      let fired = 0;
      if (!CFG.HARVEST_WORKER_URL) {
        notes.push("async skipped: HARVEST_WORKER_URL is not set in config.js");
      } else {
        // Independent fire-and-forget POSTs — dispatch concurrently. A non-2xx (e.g. a
        // 404 from an inactive worker workflow) is a FAILED dispatch, not a success.
        const results = await Promise.allSettled(jobs.map((job) =>
          fetch(CFG.HARVEST_WORKER_URL, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(job),
          }).then((res) => {
            if (!res.ok) throw new Error(`worker replied ${res.status} — is the n8n workflow active?`);
          })
        ));
        results.forEach((r, i) => {
          if (r.status === "fulfilled") fired++;
          else notes.push(`async dispatch failed for ${jobs[i].source}: ${r.reason.message}`);
        });
      }
      if (fired) notes.push(`async: ${fired} job(s) dispatched — results land in the queue in a few minutes, hit Refresh`);
      if (plan.skipped && plan.skipped.length) notes.push(`skipped: ${plan.skipped.map((s) => s.source + " (" + s.reason + ")").join(", ")}`);
    }
    src.lastRun = notes.join(" · ") || "nothing ran";
    toast("Search done");
  } catch (e) {
    src.lastRun = "failed: " + e.message;
    toast("Search failed: " + e.message, true);
  } finally {
    src.busy = false;
    try {
      await refreshSource();
    } catch (e) {
      // The search outcome is already in src.lastRun — a failed queue reload must not
      // leave the button stuck on "Searching…" or escape as an unhandled rejection.
      if (isActive("source")) render();
      toast("Queue reload failed: " + e.message, true);
    }
  }
}

// Promote/discard share one in-flight lock: a double-click on Promote fires two
// concurrent calls that can BOTH read the rows as status=new and double-emit events
// (the backend's status flip is not atomic with the read).
function lockQueueButtons() {
  const p = $("#spromote"), d = $("#sdiscard");
  if (p) p.disabled = true;
  if (d) d.disabled = true;
}

async function doPromote() {
  const ids = [...src.chosen];
  if (!ids.length || !src.promoteTo || src.opBusy) return;
  src.opBusy = true;
  lockQueueButtons();
  try {
    const r = await fn("m2-contentsource", { mode: "promote", ids, pages: [src.promoteTo] });
    if (r.errors && r.errors.length) {
      // Partial failure (HTTP 207): events may already be in the stream while the rows
      // stayed status=new — surface it instead of toasting plain success.
      toast(`Promoted ${r.written} event(s) — but: ${r.errors.join(" | ")}`, true);
    } else {
      // fresh < pulled means the freshness invariant deduped some — say so rather than
      // let it look like a silent partial failure.
      const dup = (r.material_pulled || 0) - (r.material_fresh || 0);
      toast(`Promoted ${r.written} event(s) to ${src.promoteTo}` + (dup > 0 ? ` · ${dup} already in the stream (deduped)` : ""));
    }
    src.chosen = new Set();
    await refreshSource();
  } catch (e) {
    toast("Promote failed: " + e.message, true);
    if (isActive("source")) render(); // restore the buttons we locked
  } finally {
    src.opBusy = false;
  }
}

async function doDiscard() {
  const ids = [...src.chosen];
  if (!ids.length || src.opBusy) return;
  src.opBusy = true;
  lockQueueButtons();
  try {
    // No event, no bridge — just a status flip, so this is a plain PostgREST write.
    await db(`/manual_search_results?id=in.(${ids.join(",")})`, {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "discarded" }),
    });
    toast(`Discarded ${ids.length} row(s)`);
    src.chosen = new Set();
    await refreshSource();
  } catch (e) {
    toast("Discard failed: " + e.message, true);
    if (isActive("source")) render();
  } finally {
    src.opBusy = false;
  }
}
