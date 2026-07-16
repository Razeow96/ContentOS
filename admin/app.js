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
  hasCampaign: false,
  editing: null,      // campaign being edited
};

/* ---------------- helpers ---------------- */

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg, bad) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (bad ? " bad" : "");
  setTimeout(() => t.classList.add("hidden"), 3800);
}

async function db(path, opts = {}) {
  const res = await fetch(REST + path, { ...opts, headers: { ...HEAD, ...(opts.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(text || res.status);
  return text ? JSON.parse(text) : null;
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
  const cat = await fetch(TREND_CATALOG).then((r) => {
    if (!r.ok) throw new Error("catalog fetch " + r.status);
    return r.json();
  });
  state.sources = (cat.sources || []).filter((s) => s && s.enabled && s.name);

  state.hasCampaign = await detectCampaign();
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
    <div class="tablewrap"><table>
      <tr><th>Page</th><th>trends_enabled</th><th>Source rows</th></tr>
      ${
    state.gates.map((g) => {
      const n = state.rows.filter((r) => r.page_id === g.page_id).length;
      return `<tr>
            <td class="mono">${esc(g.page_id)}</td>
            <td><input type="checkbox" class="switch" data-gate="${esc(g.page_id)}" ${g.trends_enabled ? "checked" : ""}></td>
            <td>${n}</td>
          </tr>`;
    }).join("") || `<tr><td colspan="3" class="empty">No pages in page_trend_settings.</td></tr>`
  }
    </table></div>
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
    const src = state.sources.find((s) => s.name === rows[0].source_name);
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
      <div class="tablewrap"><table>
        <tr><th>Page</th><th>Platform</th><th>Settings</th><th>Enabled</th></tr>
        ${
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
      }).join("")
    }
      </table></div>
    </div>`;
    void src;
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
            <div class="feedmeta mono">${esc(t.source)} · ${esc(t.region ?? "—")} · ${esc(t.timeframe ?? "—")} · ${esc((t.detected_at || "").slice(0, 16).replace("T", " "))}</div>
          </div>`).join("")
      : `<p class="empty">No trends detected yet. M1's daily trigger is intentionally inactive until M2 has a live consumer.</p>`
  }
  </div>`;

  $("#screen").innerHTML = html;
  wireTrend();
  if (state.editing !== null) renderEditor();
}

function wireTrend() {
  document.querySelectorAll("[data-gate]").forEach((el) =>
    el.addEventListener("change", async () => {
      const page = el.dataset.gate;
      try {
        await db("/page_trend_settings?page_id=eq." + encodeURIComponent(page), {
          method: "PATCH",
          body: JSON.stringify({ trends_enabled: el.checked }),
        });
        const g = state.gates.find((x) => x.page_id === page);
        if (g) g.trends_enabled = el.checked;
        toast(`${page}: trends ${el.checked ? "enabled" : "disabled"}`);
      } catch (e) {
        el.checked = !el.checked;
        toast("Gate update failed: " + e.message, true);
      }
    })
  );

  document.querySelectorAll("[data-row]").forEach((el) =>
    el.addEventListener("change", async () => {
      try {
        await db("/page_trend_sources?id=eq." + el.dataset.row, {
          method: "PATCH",
          body: JSON.stringify({ enabled: el.checked }),
        });
        const r = state.rows.find((x) => String(x.id) === el.dataset.row);
        if (r) r.enabled = el.checked;
        toast("Row " + (el.checked ? "enabled" : "disabled"));
      } catch (e) {
        el.checked = !el.checked;
        toast("Update failed: " + e.message, true);
      }
    })
  );

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
    ${
    dead.length
      ? `<p class="hint">Not used by <span class="mono">${esc(src.name)}</span>: <span class="mono">${dead.join(", ")}</span>.
           ${dead.includes("category") || dead.includes("keywords")
        ? `M1 fills <span class="mono">category</span>/<span class="mono">keywords</span> from the platform's own response, so those columns are dead config for every source.`
        : ""}</p>`
      : ""
  }

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
  const name = (e.isNew ? $("#cname").value : e.name).trim();
  if (!name) return toast("Campaign needs a name", true);
  if (!e.pages.length) return toast("Tick at least one page", true);
  if (e.isNew && state.rows.some((r) => r.campaign === name)) return toast("That campaign name already exists", true);

  const src = state.sources.find((s) => s.name === e.source_name);
  const rows = e.pages.map((p) => {
    const row = { page_id: p, source_name: e.source_name, campaign: name, enabled: true };
    for (const c of usedCols(src)) {
      const v = e.values[c];
      if (v === undefined || v === "") continue;
      row[c] = c === "max_results" ? Number(v) : v;
    }
    return row;
  });

  try {
    // Replace the campaign wholesale: config rows carry no state worth preserving,
    // and this keeps "what you see is what is stored" literally true.
    await db("/page_trend_sources?campaign=eq." + encodeURIComponent(name), { method: "DELETE" });
    await db("/page_trend_sources", { method: "POST", body: JSON.stringify(rows) });
    toast(`Campaign "${name}" saved — ${rows.length} row(s)`);
    state.editing = null;
    await refresh();
  } catch (err) {
    toast("Save failed: " + err.message, true);
  }
}

/* ---------------- infrastructure screen (M0 rate-limit audit) ---------------- */

const infra = { provider: "", deniedOnly: false, timer: null };

async function renderInfra() {
  const day = new Date().toISOString().slice(0, 10);
  let limits = [], counters = [], log = [];
  try {
    [limits, counters] = await Promise.all([
      db("/api_rate_limits?select=*&order=provider.asc"),
      db(`/api_usage_counters?select=*&day=eq.${day}`),
    ]);
    let q = `/api_request_log?select=*&order=requested_at.desc&limit=100`;
    if (infra.provider) q += `&provider=eq.${encodeURIComponent(infra.provider)}`;
    if (infra.deniedOnly) q += `&allowed=eq.false`;
    log = await db(q);
  } catch (e) {
    return ($("#screen").innerHTML = `<h1>Infrastructure</h1>
      <div class="card"><h2>Rate-limit tables missing</h2>
      <p class="hint">Run <span class="mono">supabase/database/20260716_m0_rate_limit.sql</span> — until then every third-party call is denied (fail-closed by design).</p>
      <p class="hint mono">${esc(e.message).slice(0, 200)}</p></div>`);
  }

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
      <div class="tablewrap"><table>
        <tr><th>Provider</th><th>Requests</th><th>Records</th><th>Enabled</th></tr>
        ${limits.map((l) => {
          const c = cnt[l.provider] || { requests: 0, records: 0 };
          return `<tr><td class="mono">${esc(l.provider)}</td>
            <td>${bar(c.requests, l.max_requests_per_day)}</td>
            <td>${bar(c.records, l.max_records_per_day)}</td>
            <td><span class="tag ${l.enabled ? "on" : "off"}">${l.enabled ? "on" : "off"}</span></td></tr>`;
        }).join("") || `<tr><td colspan="4" class="empty">No budgets configured.</td></tr>`}
      </table></div>
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
      <div class="tablewrap"><table>
        <tr><th>When (UTC)</th><th>Provider</th><th>Method</th><th>OK</th><th>Status</th><th>Recs</th><th>ms</th><th>URL / deny reason</th></tr>
        ${log.map((r) => `<tr>
            <td class="mono">${esc((r.requested_at || "").slice(5, 19).replace("T", " "))}</td>
            <td class="mono">${esc(r.provider)}</td>
            <td class="mono">${esc(r.method)}</td>
            <td><span class="tag ${r.allowed ? "on" : "warn"}">${r.allowed ? "✓" : "DENIED"}</span></td>
            <td class="mono">${r.status ?? "—"}</td>
            <td class="mono">${r.records ?? r.estimated_records ?? "—"}</td>
            <td class="mono">${r.duration_ms ?? "—"}</td>
            <td class="mono" style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.deny_reason || r.url || "")}</td>
          </tr>`).join("") || `<tr><td colspan="8" class="empty">No requests logged yet.</td></tr>`}
      </table></div>
    </div>`;

  $("#ifprov").addEventListener("change", (e) => { infra.provider = e.target.value; renderInfra(); });
  $("#ifdenied").addEventListener("change", (e) => { infra.deniedOnly = e.target.checked; renderInfra(); });
  $("#ifrefresh").addEventListener("click", renderInfra);
}

/* ---------------- source screen (RAZ-40) ---------------- */

function renderSource() {
  $("#screen").innerHTML = `<h1>Content Source</h1>
    <p class="sub">M2 material config.</p>
    <div class="card">
      <h2>Not built yet <span class="tag warn">RAZ-40</span></h2>
      <p class="hint">v2 of AR-1: the adapter board (deployed catalog truth), the three campaign tabs (material / reference / article), <span class="mono">sources_enabled</span> gates, and run-now.</p>
      <p class="hint">Run-now already has its endpoint: the RAZ-36 harvest webhook <span class="mono">POST /webhook/m2-reference-harvest</span> with <span class="mono">{ref_ids:[…]}</span>.</p>
    </div>`;
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
  else renderSource();

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
