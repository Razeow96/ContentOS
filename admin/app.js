/* Content OS · Admin (AR-1) — operator UI over the config plane.
 * Local-only. Reads/writes the page_* config tables via PostgREST and reads the
 * REAL trendsource.json off disk, so the platform list is never a second copy of
 * the catalog. Requires a static server at the REPO ROOT (see readme.md).
 */

const CFG = window.CONTENT_OS_CONFIG || {};
const REST = (CFG.SUPABASE_URL || "").replace(/\/$/, "") + "/rest/v1";
const HEAD = {
  apikey: CFG.SUPABASE_KEY || "",
  Authorization: "Bearer " + (CFG.SUPABASE_KEY || ""),
  "Content-Type": "application/json",
};

// Catalog paths are relative to /admin/ — served from the repo root.
const TREND_CATALOG = "../supabase/functions/m1-trend/trendsource.json";

const state = {
  screen: "trend",
  sources: [],        // enabled entries from trendsource.json
  rows: [],           // page_trend_sources
  gates: [],          // page_trend_settings
  trends: [],
  hasCampaign: null,   // null = not probed yet; probed once per session
  editing: null,      // campaign being edited
};

/* ---------------- helpers ---------------- */

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let toastTimer = null;
function toast(msg, bad) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (bad ? " bad" : "");
  clearTimeout(toastTimer); // a stale timer from an earlier toast must not hide this one
  toastTimer = setTimeout(() => t.classList.add("hidden"), 3800);
}

// Shared request core: fetch with the auth headers, read text, tolerant-parse JSON.
// db() and fn() layer their own error semantics on top of the same pipeline.
async function http(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...HEAD, ...(opts.headers || {}) } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { res, text, json };
}

async function db(path, opts = {}) {
  const { res, text, json } = await http(REST + path, opts);
  if (!res.ok) throw new Error(text || res.status);
  return json;
}

const fmtTs = (ts, from = 0, to = 16) => String(ts || "").slice(from, to).replace("T", " ");

// Table shell with the empty-state fallback; colspan derived from the headers so it
// can never drift when a column is added. A header is a string or {h, w}.
function table(cols, rowsHtml, empty) {
  const ths = cols.map((c) => (typeof c === "string" ? `<th>${c}</th>` : `<th style="width:${c.w}">${c.h}</th>`)).join("");
  return `<div class="tablewrap"><table>
    <tr>${ths}</tr>
    ${rowsHtml || `<tr><td colspan="${cols.length}" class="empty">${empty || ""}</td></tr>`}
  </table></div>`;
}

// The two catalog JSONs are static per session (they change on edit/deploy, not at
// runtime) — fetch each once and cache; reload the page to pick up a new deploy.
const catalogCache = new Map();
async function loadCatalog(path) {
  if (!catalogCache.has(path)) {
    const res = await fetch(path);
    if (!res.ok) throw new Error("catalog fetch " + res.status);
    catalogCache.set(path, await res.json());
  }
  return catalogCache.get(path);
}

function banner(html, bad) {
  const b = $("#banner");
  if (!html) return b.classList.add("hidden");
  b.className = "banner" + (bad ? " bad" : "");
  b.innerHTML = html;
}

/* ---------------- honest fields ----------------
 * Derived from the source's REAL url template, never hardcoded:
 *   fetch  -> the placeholder is in the url, so it changes WHAT is pulled
 *   label  -> not in the url, but m1 normalize stamps it onto the event
 *   unused -> the engine never reads this column for this source
 * category/keywords are ALWAYS unused: m1 fills those from the platform's
 * response via field_map, so the columns of the same name are dead config.
 */
const COLS = ["region", "language", "country", "chart", "max_results", "category", "keywords"];

function fieldMode(src, col) {
  const url = String(src.url || "");
  const has = (k) => url.includes("{" + k + "}");
  if (col === "category" || col === "keywords") return "unused";
  if (col === "max_results") return has("max") ? "fetch" : "unused";
  if (col === "chart") return has("chart") ? "fetch" : "unused";
  if (has(col)) return "fetch";
  const d = src.defaults || {};
  return d[col] !== undefined && d[col] !== null ? "label" : "unused";
}

function usedCols(src) {
  return COLS.filter((c) => fieldMode(src, c) !== "unused");
}
function deadCols(src) {
  return COLS.filter((c) => fieldMode(src, c) === "unused");
}

/* ---------------- load ---------------- */

async function detectCampaign() {
  try {
    await db("/page_trend_sources?select=campaign&limit=1");
    return true;
  } catch {
    return false;
  }
}

async function loadAll() {
  const cat = await loadCatalog(TREND_CATALOG);
  state.sources = (cat.sources || []).filter((s) => s && s.enabled && s.name);

  // The schema can't change mid-session — probe once, not on every refresh.
  if (state.hasCampaign === null) state.hasCampaign = await detectCampaign();
  const sel = state.hasCampaign ? "*" : "id,page_id,source_name,region,language,country,category,keywords,chart,max_results,enabled";
  const [rows, gates, trends] = await Promise.all([
    db("/page_trend_sources?select=" + sel + "&order=id.asc"),
    db("/page_trend_settings?select=*&order=page_id.asc"),
    db("/trends?select=topic,source,region,detected_at,timeframe&order=detected_at.desc&limit=40").catch(() => []),
  ]);
  state.rows = rows || [];
  state.gates = gates || [];
  state.trends = trends || [];
}

/* ---------------- trend screen ---------------- */

function campaignsOf() {
  const map = new Map();
  for (const r of state.rows) {
    const key = (state.hasCampaign && r.campaign) || "__ungrouped__";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return map;
}

function renderTrend() {
  const groups = campaignsOf();
  const pages = state.gates.map((g) => g.page_id);

  let html = `<h1>Trend</h1>
    <p class="sub">M1 signal config — which platforms each page listens to.</p>`;

  /* gates */
  html += `<div class="card">
    <h2>Pages &amp; gates</h2>
    <p class="hint">A page only pulls trends when <span class="mono">trends_enabled</span> is on. This is the master switch — source rows below are ignored while it is off.</p>
    ${
    table(
      ["Page", "trends_enabled", "Source rows"],
      state.gates.map((g) => {
        const n = state.rows.filter((r) => r.page_id === g.page_id).length;
        return `<tr>
            <td class="mono">${esc(g.page_id)}</td>
            <td><input type="checkbox" class="switch" data-gate="${esc(g.page_id)}" ${g.trends_enabled ? "checked" : ""}></td>
            <td>${n}</td>
          </tr>`;
      }).join(""),
      "No pages in page_trend_settings.",
    )
  }
    <div class="row" style="margin-top:12px">
      <input type="text" id="newpage" placeholder="new page_id">
      <button class="btn ghost" id="addpage">Add page</button>
    </div>
  </div>`;

  /* campaigns */
  html += `<div class="card">
    <div class="spread"><h2>Campaigns</h2>
      <button class="btn" id="newcamp" ${state.hasCampaign ? "" : "disabled"}>New campaign</button></div>
    <p class="hint">A campaign is a named group of <span class="mono">page_trend_sources</span> rows — one row per selected page. The engine never reads the name; it is grouping for you only.</p>`;

  if (!groups.size) html += `<p class="empty">No trend source rows yet.</p>`;

  for (const [name, rows] of groups) {
    const ungrouped = name === "__ungrouped__";
    html += `<div style="margin-bottom:14px">
      <div class="spread">
        <div>
          <strong>${ungrouped ? "Ungrouped rows" : esc(name)}</strong>
          ${ungrouped ? `<span class="tag warn" style="margin-left:6px">no campaign</span>` : ""}
        </div>
        <div class="row">
          ${
      !ungrouped
        ? `<button class="btn ghost" data-edit="${esc(name)}">Edit</button>
                 <button class="btn danger" data-del="${esc(name)}">Delete</button>`
        : ""
    }
        </div>
      </div>
      ${ungrouped ? `<p class="hint">Rows created before campaigns existed. Editing them here would guess at grouping, so they are listed read-only — assign a campaign by editing the row's <span class="mono">campaign</span> column, or rebuild them as a campaign.</p>` : ""}
      ${
      table(
        ["Page", "Platform", "Settings", "Enabled"],
        rows.map((r) => {
          const s = state.sources.find((x) => x.name === r.source_name);
          const cells = s
            ? usedCols(s).map((c) => `${c}=${esc(r[c] ?? "—")}`).join(" · ")
            : `<span class="tag warn">unknown/disabled source</span>`;
          return `<tr>
              <td class="mono">${esc(r.page_id)}</td>
              <td class="mono">${esc(r.source_name)}</td>
              <td class="mono">${cells}</td>
              <td><input type="checkbox" class="switch" data-row="${r.id}" ${r.enabled ? "checked" : ""}></td>
            </tr>`;
        }).join(""),
      )
    }
    </div>`;
  }
  html += `</div>`;

  /* editor mount */
  html += `<div id="editor"></div>`;

  /* feed */
  html += `<div class="card">
    <h2>Recent trends <span class="tag">read-only</span></h2>
    <p class="hint">Latest rows in <span class="mono">trends</span> — what M1 actually detected.</p>
    ${
    state.trends.length
      ? state.trends.map((t) => `<div class="feeditem">
            <div>${esc(t.topic)}</div>
            <div class="feedmeta mono">${esc(t.source)} · ${esc(t.region ?? "—")} · ${esc(t.timeframe ?? "—")} · ${esc(fmtTs(t.detected_at))}</div>
          </div>`).join("")
      : `<p class="empty">No trends detected yet. M1's daily trigger is intentionally inactive until M2 has a live consumer.</p>`
  }
  </div>`;

  $("#screen").innerHTML = html;
  wireTrend();
  if (state.editing !== null) renderEditor();
}

// One optimistic-toggle pattern for every switch: run the PATCH+state-sync, and on
// failure revert the checkbox and toast — so the rollback logic exists exactly once.
function wireSwitch(attr, apply) {
  document.querySelectorAll(`[${attr}]`).forEach((el) =>
    el.addEventListener("change", async () => {
      try {
        await apply(el);
      } catch (e) {
        el.checked = !el.checked;
        toast("Update failed: " + e.message, true);
      }
    })
  );
}

function wireTrend() {
  wireSwitch("data-gate", async (el) => {
    const page = el.dataset.gate;
    await db("/page_trend_settings?page_id=eq." + encodeURIComponent(page), {
      method: "PATCH",
      body: JSON.stringify({ trends_enabled: el.checked }),
    });
    const g = state.gates.find((x) => x.page_id === page);
    if (g) g.trends_enabled = el.checked;
    toast(`${page}: trends ${el.checked ? "enabled" : "disabled"}`);
  });

  wireSwitch("data-row", async (el) => {
    await db("/page_trend_sources?id=eq." + el.dataset.row, {
      method: "PATCH",
      body: JSON.stringify({ enabled: el.checked }),
    });
    const r = state.rows.find((x) => String(x.id) === el.dataset.row);
    if (r) r.enabled = el.checked;
    toast("Row " + (el.checked ? "enabled" : "disabled"));
  });

  $("#addpage")?.addEventListener("click", async () => {
    const id = $("#newpage").value.trim();
    if (!id) return;
    try {
      await db("/page_trend_settings", { method: "POST", body: JSON.stringify({ page_id: id, trends_enabled: false }) });
      toast("Page added (gate off)");
      await refresh();
    } catch (e) {
      toast("Add page failed: " + e.message, true);
    }
  });

  $("#newcamp")?.addEventListener("click", () => {
    state.editing = { name: "", source_name: state.sources[0]?.name || "", values: {}, pages: [], isNew: true };
    renderEditor();
  });

  document.querySelectorAll("[data-edit]").forEach((el) =>
    el.addEventListener("click", () => {
      const name = el.dataset.edit;
      const rows = state.rows.filter((r) => r.campaign === name);
      const first = rows[0] || {};
      state.editing = {
        name,
        source_name: first.source_name,
        values: Object.fromEntries(COLS.map((c) => [c, first[c]])),
        pages: rows.map((r) => r.page_id),
        isNew: false,
      };
      renderEditor();
    })
  );

  document.querySelectorAll("[data-del]").forEach((el) =>
    el.addEventListener("click", async () => {
      const name = el.dataset.del;
      const n = state.rows.filter((r) => r.campaign === name).length;
      if (!confirm(`Delete campaign "${name}"? This removes ${n} page_trend_sources row(s). M1 stops pulling those.`)) return;
      try {
        await db("/page_trend_sources?campaign=eq." + encodeURIComponent(name), { method: "DELETE" });
        toast(`Campaign "${name}" deleted`);
        state.editing = null;
        await refresh();
      } catch (e) {
        toast("Delete failed: " + e.message, true);
      }
    })
  );
}

function renderEditor() {
  const e = state.editing;
  if (!e) return ($("#editor").innerHTML = "");
  const src = state.sources.find((s) => s.name === e.source_name) || state.sources[0];
  if (!src) return;

  const dead = deadCols(src);
  const fields = usedCols(src).map((c) => {
    const mode = fieldMode(src, c);
    const d = (src.defaults || {})[c] ?? (c === "max_results" ? (src.defaults || {}).max : "");
    const val = e.values[c] ?? "";
    return `<label class="field">
      ${c}
      <input type="${c === "max_results" ? "number" : "text"}" data-f="${c}" value="${esc(val)}" placeholder="${esc(d ?? "")}">
      <span class="fieldnote ${mode === "label" ? "label-only" : ""}">${
      mode === "fetch" ? "changes what is pulled" : "labels the event only — does not change what is pulled"
    }</span>
    </label>`;
  }).join("");

  $("#editor").innerHTML = `<div class="card">
    <h2>${e.isNew ? "New campaign" : "Edit campaign"}</h2>
    <div class="row" style="margin-bottom:14px">
      <label class="field">campaign name
        <input type="text" id="cname" value="${esc(e.name)}" ${e.isNew ? "" : "disabled"}>
      </label>
      <label class="field">platform
        <select id="csrc">
          ${state.sources.map((s) => `<option value="${esc(s.name)}" ${s.name === src.name ? "selected" : ""}>${esc(s.name)} (${esc(s.timeframe)})</option>`).join("")}
        </select>
        <span class="fieldnote">only enabled sources in trendsource.json</span>
      </label>
    </div>

    <div class="row" style="margin-bottom:6px">${fields}</div>
    <p class="hint">Not used by <span class="mono">${esc(src.name)}</span>: <span class="mono">${dead.join(", ")}</span>.
      M1 fills <span class="mono">category</span>/<span class="mono">keywords</span> from the platform's own response, so those columns are dead config for every source.</p>

    <h2 style="margin-top:16px">Pages</h2>
    <p class="hint">One row per ticked page. Pages with the gate off still get a row, but M1 skips them until the gate is on.</p>
    <div class="checks">
      ${
    state.gates.map((g) => `<label class="check">
          <input type="checkbox" data-p="${esc(g.page_id)}" ${e.pages.includes(g.page_id) ? "checked" : ""}>
          ${esc(g.page_id)} ${g.trends_enabled ? "" : `<span class="tag warn">gate off</span>`}
        </label>`).join("") || `<p class="empty">No pages yet — add one above.</p>`
  }
    </div>

    <div class="row" style="margin-top:16px">
      <button class="btn" id="save">Save campaign</button>
      <button class="btn ghost" id="cancel">Cancel</button>
    </div>
  </div>`;

  $("#csrc").addEventListener("change", (ev) => {
    e.source_name = ev.target.value;
    e.values = {};
    renderEditor();
  });
  document.querySelectorAll("[data-f]").forEach((el) =>
    el.addEventListener("input", () => (e.values[el.dataset.f] = el.value))
  );
  document.querySelectorAll("[data-p]").forEach((el) =>
    el.addEventListener("change", () => {
      const p = el.dataset.p;
      e.pages = el.checked ? [...new Set([...e.pages, p])] : e.pages.filter((x) => x !== p);
    })
  );
  $("#cancel").addEventListener("click", () => {
    state.editing = null;
    renderTrend();
  });
  $("#save").addEventListener("click", saveCampaign);
}

async function saveCampaign() {
  const e = state.editing;
  if (e.saving) return; // a double-click must not interleave two replace sequences
  const name = (e.isNew ? $("#cname").value : e.name).trim();
  if (!name) return toast("Campaign needs a name", true);
  if (!e.pages.length) return toast("Tick at least one page", true);
  if (e.isNew && state.rows.some((r) => r.campaign === name)) return toast("That campaign name already exists", true);

  const src = state.sources.find((s) => s.name === e.source_name);
  if (!src) return toast(`Source "${e.source_name}" is no longer in the catalog — pick a platform again`, true);
  const rows = e.pages.map((p) => {
    const row = { page_id: p, source_name: e.source_name, campaign: name, enabled: true };
    for (const c of usedCols(src)) {
      const v = e.values[c];
      if (v === undefined || v === "") continue;
      row[c] = c === "max_results" ? Number(v) : v;
    }
    return row;
  });

  e.saving = true;
  const btn = $("#save");
  if (btn) btn.disabled = true;
  try {
    // Replace the campaign wholesale, but INSERT-FIRST: write the new rows, then delete
    // only the stale ones by id. The old DELETE-then-POST order destroyed the campaign
    // whenever the POST failed; this order's worst failure mode is visible duplicates
    // (delete failed after insert), never a wiped campaign.
    const inserted = await db("/page_trend_sources", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(rows),
    });
    const keep = (inserted || []).map((r) => r.id);
    if (!keep.length) throw new Error("insert returned no rows — old rows left untouched");
    await db(`/page_trend_sources?campaign=eq.${encodeURIComponent(name)}&id=not.in.(${keep.join(",")})`, {
      method: "DELETE",
    });
    toast(`Campaign "${name}" saved — ${rows.length} row(s)`);
    state.editing = null;
    await refresh();
  } catch (err) {
    toast("Save failed: " + err.message, true);
  } finally {
    e.saving = false;
    if (btn) btn.disabled = false;
  }
}

/* ---------------- infrastructure screen (M0 rate-limit audit) ---------------- */

const infra = { provider: "", deniedOnly: false, seq: 0, limits: null, counters: null };

// reuseBudgets=true (filter changes): only the ledger query depends on the filters, so
// budgets/counters are reused from the last full load instead of refetched.
async function renderInfra(reuseBudgets) {
  // Stale-response guard: only the newest invocation may paint, and only while the
  // Infrastructure screen is still the active one.
  const seq = ++infra.seq;
  const stale = () => seq !== infra.seq || state.screen !== "infra";
  const day = new Date().toISOString().slice(0, 10);
  let log = [];
  try {
    if (!reuseBudgets || !infra.limits) {
      [infra.limits, infra.counters] = await Promise.all([
        db("/api_rate_limits?select=*&order=provider.asc"),
        db(`/api_usage_counters?select=*&day=eq.${day}`),
      ]);
    }
    let q = `/api_request_log?select=*&order=requested_at.desc&limit=100`;
    if (infra.provider) q += `&provider=eq.${encodeURIComponent(infra.provider)}`;
    if (infra.deniedOnly) q += `&allowed=eq.false`;
    log = await db(q);
  } catch (e) {
    if (stale()) return;
    return ($("#screen").innerHTML = `<h1>Infrastructure</h1>
      <div class="card"><h2>Rate-limit tables missing</h2>
      <p class="hint">Run <span class="mono">supabase/database/20260716_m0_rate_limit.sql</span> — until then every third-party call is denied (fail-closed by design).</p>
      <p class="hint mono">${esc(e.message).slice(0, 200)}</p></div>`);
  }
  if (stale()) return;

  const limits = infra.limits, counters = infra.counters;
  const cnt = Object.fromEntries(counters.map((c) => [c.provider, c]));
  const bar = (used, max) => {
    if (max === null || max === undefined) return `<span class="tag">no cap</span>`;
    const pct = Math.min(100, Math.round((used / max) * 100));
    const col = pct >= 90 ? "var(--bad)" : pct >= 60 ? "var(--warn)" : "var(--ok)";
    return `<div style="background:var(--panel-2);border-radius:4px;height:8px;width:140px;display:inline-block;vertical-align:middle">
      <div style="background:${col};height:8px;border-radius:4px;width:${pct}%"></div></div>
      <span class="mono" style="margin-left:6px">${used}/${max}</span>`;
  };

  $("#screen").innerHTML = `<h1>Infrastructure</h1>
    <p class="sub">M0 API gate — every third-party call needs approval; every attempt is on the ledger.</p>

    <div class="card">
      <h2>Today's budgets</h2>
      <p class="hint">From <span class="mono">api_rate_limits</span> (config = data; edit rows to change budgets). A provider with no row is denied.</p>
      ${
      table(
        ["Provider", "Requests", "Records", "Enabled"],
        limits.map((l) => {
          const c = cnt[l.provider] || { requests: 0, records: 0 };
          return `<tr><td class="mono">${esc(l.provider)}</td>
            <td>${bar(c.requests, l.max_requests_per_day)}</td>
            <td>${bar(c.records, l.max_records_per_day)}</td>
            <td><span class="tag ${l.enabled ? "on" : "off"}">${l.enabled ? "on" : "off"}</span></td></tr>`;
        }).join(""),
        "No budgets configured.",
      )
    }
    </div>

    <div class="card">
      <div class="spread"><h2>Request ledger <span class="tag">last 100</span></h2>
        <div class="row">
          <select id="ifprov"><option value="">all providers</option>
            ${limits.map((l) => `<option value="${esc(l.provider)}" ${infra.provider === l.provider ? "selected" : ""}>${esc(l.provider)}</option>`).join("")}
          </select>
          <label class="check"><input type="checkbox" id="ifdenied" ${infra.deniedOnly ? "checked" : ""}> denied only</label>
          <button class="btn ghost" id="ifrefresh">Refresh</button>
        </div>
      </div>
      ${
      table(
        ["When (UTC)", "Provider", "Method", "OK", "Status", "Recs", "ms", "URL / deny reason"],
        log.map((r) => `<tr>
            <td class="mono">${esc(fmtTs(r.requested_at, 5, 19))}</td>
            <td class="mono">${esc(r.provider)}</td>
            <td class="mono">${esc(r.method)}</td>
            <td><span class="tag ${r.allowed ? "on" : "warn"}">${r.allowed ? "✓" : "DENIED"}</span></td>
            <td class="mono">${r.status ?? "—"}</td>
            <td class="mono">${r.records ?? r.estimated_records ?? "—"}</td>
            <td class="mono">${r.duration_ms ?? "—"}</td>
            <td class="mono" style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.deny_reason || r.url || "")}</td>
          </tr>`).join(""),
        "No requests logged yet.",
      )
    }
    </div>`;

  $("#ifprov").addEventListener("change", (e) => { infra.provider = e.target.value; renderInfra(true); });
  $("#ifdenied").addEventListener("change", (e) => { infra.deniedOnly = e.target.checked; renderInfra(true); });
  $("#ifrefresh").addEventListener("click", () => renderInfra());
}

/* ---------------- source screen (RAZ-40 · manual search + review · RAZ-37) ----------------
 * TWO PANELS, because the two halves genuinely run on different clocks:
 *   Panel A "Search"  — sync sources (TMDB + the 5 AI-search scrapers, 19-78s) answer inline.
 *   Panel B "Review"  — the queue over manual_search_results. Async keyword DISCOVERY
 *                       (bd_youtube_search, minutes) can ONLY land here, never inline.
 * Nothing reaches source_events from here except via Promote — the one explicit human step.
 */

const SOURCE_CATALOG = "../supabase/functions/m2-contentsource/sources.json";
const FN = (CFG.SUPABASE_URL || "").replace(/\/$/, "") + "/functions/v1/m2-contentsource";

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

async function fn(body) {
  const { res, text, json } = await http(FN, { method: "POST", body: JSON.stringify(body) });
  // A 2xx that isn't JSON is a broken proxy/gateway, not a success — never return null
  // (callers dereference the result immediately).
  if (!json) throw new Error(`${res.status}: ${(text || "empty response").slice(0, 200)}`);
  if (json.ok === false && json.error) throw new Error(json.error);
  return json;
}

// A source is ASYNC when it is a Bright Data keyword-DISCOVERY job — the same predicate
// the backend's buildSearchPlan uses (type=brightdata + bd_input=keyword). Discovery
// cannot answer inside the function's sync budget (measured: 112.6s, 0 records) and
// must go via search_plan -> n8n.
const isAsync = (s) => s.type === "brightdata" && s.bd_input === "keyword";

async function loadSource() {
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

function renderSource() {
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
      <h2>Search <span class="tag">panel A</span></h2>
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
        <h2>Review queue <span class="tag">panel B</span> <span class="tag ${q.length ? "on" : ""}">${q.length} new</span></h2>
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
            <td>${p.image_url ? `<img src="${esc(p.image_url)}" alt="" style="width:46px;height:26px;object-fit:cover;border-radius:3px;vertical-align:middle;margin-right:8px">` : ""}${esc(String(p.title || "").slice(0, 78))}</td>
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
      if (wantToggle !== !!$("#svt")) renderSource();
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
  await loadSource();
  if (state.screen === "source") renderSource();
}

async function runSearch() {
  const kw = (src.keyword || "").trim();
  if (!kw) return toast("Enter a keyword", true);
  if (!src.picked.size) return toast("Pick at least one source", true);

  const names = [...src.picked];
  const asyncNames = names.filter((n) => src.catalog.some((s) => s.name === n && isAsync(s)));
  const syncNames = names.filter((n) => !asyncNames.includes(n));

  src.busy = true; src.lastRun = null; renderSource();
  const notes = [];
  try {
    // Sync half: answers inline, writes straight to the queue (sink=manual).
    if (syncNames.length) {
      const r = await fn({ mode: "search", keyword: kw, sources: syncNames, sink: "manual", ai_assist: src.aiAssist });
      notes.push(`sync: ${r.written} result(s) from ${(r.sources || []).join(", ") || "—"}`);
      if (r.errors && r.errors.length) notes.push(`errors: ${r.errors.join(" | ")}`);
    }
    // Async half: search_plan only PLANS. n8n runs the slow trigger->poll->download->ingest.
    if (asyncNames.length) {
      const plan = await fn({
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
      if (state.screen === "source") renderSource();
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
    const r = await fn({ mode: "promote", ids, pages: [src.promoteTo] });
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
    if (state.screen === "source") renderSource(); // restore the buttons we locked
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
    if (state.screen === "source") renderSource();
  } finally {
    src.opBusy = false;
  }
}

/* ---------------- boot ---------------- */

async function refresh() {
  await loadAll();
  render();
}

function render() {
  document.querySelectorAll(".navitem").forEach((b) => b.classList.toggle("active", b.dataset.screen === state.screen));
  if (state.screen === "trend") renderTrend();
  else if (state.screen === "infra") renderInfra();
  else {
    // Source data is loaded lazily — the trend screen is the default and must not pay
    // for a catalog fetch + two queries it never uses. Guard both outcomes on the
    // screen still being active: a slow response must never repaint over another screen.
    loadSource().then(() => {
      if (state.screen === "source") renderSource();
    }).catch((e) => {
      if (state.screen !== "source") return;
      $("#screen").innerHTML = `<h1>Content Source</h1><div class="card"><h2>Could not load</h2>
        <p class="hint mono">${esc(e.message).slice(0, 240)}</p>
        <p class="hint">The catalog is fetched from <span class="mono">${esc(SOURCE_CATALOG)}</span> — serve from the REPO ROOT, not from inside /admin.</p></div>`;
    });
  }

  if (!state.hasCampaign) {
    banner(
      `<strong>Campaign column missing.</strong> Campaign create/edit is disabled until this runs — everything else works.
       <pre>ALTER TABLE page_trend_sources     ADD COLUMN IF NOT EXISTS campaign text;
ALTER TABLE page_material_sources  ADD COLUMN IF NOT EXISTS campaign text;
ALTER TABLE page_reference_sources ADD COLUMN IF NOT EXISTS campaign text;
ALTER TABLE page_article_sources   ADD COLUMN IF NOT EXISTS campaign text;</pre>`,
    );
  } else banner(null);
}

document.querySelectorAll(".navitem").forEach((b) =>
  b.addEventListener("click", () => {
    state.screen = b.dataset.screen;
    state.editing = null;
    render();
  })
);

(async () => {
  const conn = $("#conn");
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_KEY) {
    conn.textContent = "config.js missing";
    conn.className = "conn bad";
    return banner(`<strong>No config.js.</strong> Copy <span class="mono">config.example.js</span> to <span class="mono">config.js</span> and put your Supabase URL + service_role key in it. It is gitignored.`, true);
  }
  try {
    await refresh();
    conn.textContent = "connected · " + REST.replace("https://", "").split(".")[0];
    conn.className = "conn ok";
  } catch (e) {
    conn.textContent = "connection failed";
    conn.className = "conn bad";
    banner(
      `<strong>Could not load.</strong> <span class="mono">${esc(e.message)}</span><br><br>
       Two usual causes: the catalog is fetched at <span class="mono">${TREND_CATALOG}</span>, so the static server must be started at the <strong>repo root</strong> (not inside <span class="mono">admin/</span>) — opening index.html via file:// will not work either.
       Or the key in config.js lacks access: these tables are RLS-protected, so the anon key reads back zero rows and cannot write. Use the service_role key.`,
      true,
    );
  }
})();
