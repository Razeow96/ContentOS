/* Trend screen (M1 signal config) — which platforms each page listens to,
 * grouped into campaigns. Reads the REAL trendsource.json off disk so the
 * platform list is never a second copy of the catalog.
 */

import { db, loadCatalog } from "../lib/api.js";
import { $, esc, fmtTs, table, toast } from "../lib/ui.js";
import { rerender } from "../lib/nav.js";

// Catalog path is relative to /admin/ — served from the repo root.
const TREND_CATALOG = "../supabase/functions/m1-trend/trendsource.json";

const S = {
  sources: [],       // enabled entries from trendsource.json
  rows: [],          // page_trend_sources
  gates: [],         // page_trend_settings
  trends: [],
  hasCampaign: null, // null = not probed yet; probed once per session
  editing: null,     // campaign being edited
};

export const hasCampaign = () => S.hasCampaign;
export function resetEditing() { S.editing = null; }

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
const usedCols = (src) => COLS.filter((c) => fieldMode(src, c) !== "unused");
const deadCols = (src) => COLS.filter((c) => fieldMode(src, c) === "unused");

async function detectCampaign() {
  try {
    await db("/page_trend_sources?select=campaign&limit=1");
    return true;
  } catch {
    return false;
  }
}

export async function load() {
  const cat = await loadCatalog(TREND_CATALOG);
  S.sources = (cat.sources || []).filter((s) => s && s.enabled && s.name);

  // The schema can't change mid-session — probe once, not on every refresh.
  if (S.hasCampaign === null) S.hasCampaign = await detectCampaign();
  const sel = S.hasCampaign ? "*" : "id,page_id,source_name,region,language,country,category,keywords,chart,max_results,enabled";
  const [rows, gates, trends] = await Promise.all([
    db("/page_trend_sources?select=" + sel + "&order=id.asc"),
    db("/page_trend_settings?select=*&order=page_id.asc"),
    db("/trends?select=topic,source,region,detected_at,timeframe&order=detected_at.desc&limit=40").catch(() => []),
  ]);
  S.rows = rows || [];
  S.gates = gates || [];
  S.trends = trends || [];
}

// Reload the trend data then re-render the whole shell (screen + global banner).
async function reload() {
  await load();
  rerender();
}

function campaignsOf() {
  const map = new Map();
  for (const r of S.rows) {
    const key = (S.hasCampaign && r.campaign) || "__ungrouped__";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return map;
}

export function render() {
  const groups = campaignsOf();

  let html = `<h1>Trend</h1>
    <p class="sub">M1 signal config — which platforms each page listens to.</p>`;

  /* gates */
  html += `<div class="card">
    <h2>Pages &amp; gates</h2>
    <p class="hint">A page only pulls trends when <span class="mono">trends_enabled</span> is on. This is the master switch — source rows below are ignored while it is off.</p>
    ${
    table(
      ["Page", "trends_enabled", "Source rows"],
      S.gates.map((g) => {
        const n = S.rows.filter((r) => r.page_id === g.page_id).length;
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
      <button class="btn" id="newcamp" ${S.hasCampaign ? "" : "disabled"}>New campaign</button></div>
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
          const s = S.sources.find((x) => x.name === r.source_name);
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
    S.trends.length
      ? S.trends.map((t) => `<div class="feeditem">
            <div>${esc(t.topic)}</div>
            <div class="feedmeta mono">${esc(t.source)} · ${esc(t.region ?? "—")} · ${esc(t.timeframe ?? "—")} · ${esc(fmtTs(t.detected_at))}</div>
          </div>`).join("")
      : `<p class="empty">No trends detected yet. M1's daily trigger is intentionally inactive until M2 has a live consumer.</p>`
  }
  </div>`;

  $("#screen").innerHTML = html;
  wireTrend();
  if (S.editing !== null) renderEditor();
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
    const g = S.gates.find((x) => x.page_id === page);
    if (g) g.trends_enabled = el.checked;
    toast(`${page}: trends ${el.checked ? "enabled" : "disabled"}`);
  });

  wireSwitch("data-row", async (el) => {
    await db("/page_trend_sources?id=eq." + el.dataset.row, {
      method: "PATCH",
      body: JSON.stringify({ enabled: el.checked }),
    });
    const r = S.rows.find((x) => String(x.id) === el.dataset.row);
    if (r) r.enabled = el.checked;
    toast("Row " + (el.checked ? "enabled" : "disabled"));
  });

  $("#addpage")?.addEventListener("click", async () => {
    const id = $("#newpage").value.trim();
    if (!id) return;
    try {
      await db("/page_trend_settings", { method: "POST", body: JSON.stringify({ page_id: id, trends_enabled: false }) });
      toast("Page added (gate off)");
      await reload();
    } catch (e) {
      toast("Add page failed: " + e.message, true);
    }
  });

  $("#newcamp")?.addEventListener("click", () => {
    S.editing = { name: "", source_name: S.sources[0]?.name || "", values: {}, pages: [], isNew: true };
    renderEditor();
  });

  document.querySelectorAll("[data-edit]").forEach((el) =>
    el.addEventListener("click", () => {
      const name = el.dataset.edit;
      const rows = S.rows.filter((r) => r.campaign === name);
      const first = rows[0] || {};
      S.editing = {
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
      const n = S.rows.filter((r) => r.campaign === name).length;
      if (!confirm(`Delete campaign "${name}"? This removes ${n} page_trend_sources row(s). M1 stops pulling those.`)) return;
      try {
        await db("/page_trend_sources?campaign=eq." + encodeURIComponent(name), { method: "DELETE" });
        toast(`Campaign "${name}" deleted`);
        S.editing = null;
        await reload();
      } catch (e) {
        toast("Delete failed: " + e.message, true);
      }
    })
  );
}

function renderEditor() {
  const e = S.editing;
  if (!e) return ($("#editor").innerHTML = "");
  const src = S.sources.find((s) => s.name === e.source_name) || S.sources[0];
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
          ${S.sources.map((s) => `<option value="${esc(s.name)}" ${s.name === src.name ? "selected" : ""}>${esc(s.name)} (${esc(s.timeframe)})</option>`).join("")}
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
    S.gates.map((g) => `<label class="check">
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
    S.editing = null;
    render();
  });
  $("#save").addEventListener("click", saveCampaign);
}

async function saveCampaign() {
  const e = S.editing;
  if (e.saving) return; // a double-click must not interleave two replace sequences
  const name = (e.isNew ? $("#cname").value : e.name).trim();
  if (!name) return toast("Campaign needs a name", true);
  if (!e.pages.length) return toast("Tick at least one page", true);
  if (e.isNew && S.rows.some((r) => r.campaign === name)) return toast("That campaign name already exists", true);

  const src = S.sources.find((s) => s.name === e.source_name);
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
    S.editing = null;
    await reload();
  } catch (err) {
    toast("Save failed: " + err.message, true);
  } finally {
    e.saving = false;
    if (btn) btn.disabled = false;
  }
}
