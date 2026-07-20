/* Trend › Campaign — the M1 signal config, as an observability-console screen.
 * A campaign = one platform + settings, subscribed by one or more pages (one
 * page_trend_sources row per page, sharing a `campaign` label). Being in a
 * campaign IS "active": the screen keeps page_trend_settings.trends_enabled in
 * lockstep with presence, so adding a page turns its gate on and removing its
 * last row turns it off — the operator never sees a separate switch.
 *
 * Platform + which fields it actually uses are read from the REAL trendsource.json
 * (never a second copy). category/keywords are always dead config here — M1 fills
 * them from each platform's own response. Obeys the 6 design rules via the shared kit.
 */

import { db, loadCatalog } from "../../lib/api.js";
import { $, esc, table, pagedBody, pageHeader, toast } from "../../lib/ui.js";
import { isActive } from "../../lib/nav.js";

const SIZE = 10;
const TREND_CATALOG = "../supabase/functions/m1-trend/trendsource.json";
const COLS = ["region", "language", "country", "chart", "max_results", "category", "keywords"];

const S = { sources: [], rows: [], gates: [], page: 0, editMode: false, editing: null, view: [] };

/* ---- honest field modes (from the source's real url template, never hardcoded) ---- */
const defKey = (c) => (c === "max_results" ? "max" : c);
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

export async function load() {
  const cat = await loadCatalog(TREND_CATALOG);
  S.sources = (cat.sources || []).filter((s) => s && s.enabled && s.name);
  const [rows, gates] = await Promise.all([
    db("/page_trend_sources?select=*&order=id.asc"),
    db("/page_trend_settings?select=*&order=page_id.asc"),
  ]);
  S.rows = rows || [];
  S.gates = gates || [];
}

// Group rows into entries: one per named campaign, plus each ungrouped (legacy,
// campaign=null) row on its own read-only line so no active subscription is hidden.
function entriesOf() {
  const named = new Map();
  const ungrouped = [];
  for (const r of S.rows) {
    if (r.campaign) { (named.get(r.campaign) || named.set(r.campaign, []).get(r.campaign)).push(r); }
    else ungrouped.push(r);
  }
  const list = [];
  for (const [name, rows] of named) {
    list.push({
      campaign: name, isCampaign: true, source_name: rows[0].source_name,
      mixed: rows.some((r) => r.source_name !== rows[0].source_name),
      rows, pages: rows.map((r) => r.page_id),
      created: rows.map((r) => r.created_at).filter(Boolean).sort()[0],
      allEnabled: rows.every((r) => r.enabled),
    });
  }
  for (const r of ungrouped) {
    list.push({
      campaign: null, isCampaign: false, source_name: r.source_name, mixed: false,
      rows: [r], pages: [r.page_id], created: r.created_at, allEnabled: r.enabled,
    });
  }
  return list;
}

export async function render() {
  S.editing = null;
  $("#screen").innerHTML = pageHeader("Trend › Campaign",
    `Which platform each page listens to, grouped as campaigns. A page is live the moment it is in a campaign — remove it to stop, delete the campaign to turn it off.`) +
    `<div class="card">
      <div class="spread">
        <h2>Campaigns <span class="count" id="campcount">·</span></h2>
        <div class="row">
          <button class="btn" id="campnew">Create</button>
          <button class="btn ghost" id="campedit">Edit</button>
        </div>
      </div>
      <div class="cardhint" id="camphint"></div>
      <div id="camptable"><p class="hint">loading…</p></div>
    </div>
    <div id="editor"></div>`;

  $("#campnew").addEventListener("click", openNew);
  $("#campedit").addEventListener("click", () => { S.editMode = !S.editMode; S.editing = null; paint(); });

  try {
    await load();
  } catch (e) {
    if (!isActive("campaign")) return;
    $("#camptable").innerHTML = `<p class="hint mono">load failed: ${esc(e.message).slice(0, 160)}</p>`;
    return;
  }
  if (!isActive("campaign")) return;
  paint();
}

async function reload() { await load(); if (isActive("campaign")) paint(); }

function paint() {
  closePopover();
  const entries = entriesOf();
  S.view = entries;
  const total = entries.length;
  $("#campcount").textContent = total;
  $("#campedit").textContent = S.editMode ? "Done" : "Edit";
  $("#camphint").innerHTML = S.editMode
    ? `Edit mode — click a campaign to change its platform, settings or pages; <span style="color:var(--bad)">✕</span> deletes it.`
    : `Platform &amp; settings come from the catalog; <span class="mono">category</span>/<span class="mono">keywords</span> are filled from each platform's own response.`;

  const start = S.page * SIZE;
  const slice = entries.slice(start, start + SIZE);
  const cols = ["Campaign", "Platform", "Settings", "Subscribers", "Created", ""];
  const rowsArr = slice.map((e, i) => entryRow(e, start + i));
  $("#camptable").innerHTML =
    table(cols, pagedBody(cols.length, rowsArr, "No campaigns yet — Create one.", SIZE)) + pager(total);

  wireRows();
  wirePager(total);
  $("#editor").innerHTML = "";
  if (S.editing !== null) renderEditor();
}

function settingsCell(entry) {
  const src = S.sources.find((x) => x.name === entry.source_name);
  if (!src) return `<span class="tag warn">unknown / disabled source</span>`;
  const r0 = entry.rows[0];
  const parts = usedCols(src).map((c) => {
    const v = r0[c] ?? (src.defaults || {})[defKey(c)] ?? "—";
    return `${c}=${esc(v)}`;
  });
  return parts.join(" · ") || "—";
}

function entryRow(entry, idx) {
  const camp = entry.isCampaign ? `<span class="mono">${esc(entry.campaign)}</span>` : `<span class="tag">ungrouped</span>`;
  const off = entry.allEnabled ? "" : ` <span class="tag off">off</span>`;
  const subs = entry.pages.length === 1
    ? `<span class="mono">${esc(entry.pages[0])}</span>`
    : `<button class="subsmore" data-i="${idx}">${entry.pages.length} pages ▾</button>`;
  const editable = S.editMode && entry.isCampaign;
  const action = editable ? `<button class="xdel" data-del="${esc(entry.campaign)}" title="Delete campaign">✕</button>` : "";
  return `<tr class="camprow${editable ? " editable" : ""}"${editable ? ` data-edit="${esc(entry.campaign)}"` : ""}>
    <td>${camp}</td>
    <td>${`<span class="mono">${esc(entry.source_name)}</span>`}${off}</td>
    <td class="mono" style="max-width:340px;overflow:hidden;text-overflow:ellipsis">${settingsCell(entry)}</td>
    <td>${subs}</td>
    <td class="mono">${esc(String(entry.created || "").slice(0, 10))}</td>
    <td>${action}</td>
  </tr>`;
}

function pager(total) {
  const pages = Math.max(1, Math.ceil(total / SIZE));
  const cur = S.page + 1;
  return `<div class="pager">
    <span class="hint">page ${cur} of ${pages} · ${total} campaign${total === 1 ? "" : "s"}</span>
    <div class="row">
      <button class="btn ghost" id="campprev" ${S.page <= 0 ? "disabled" : ""}>Prev</button>
      <button class="btn ghost" id="campnext" ${cur >= pages ? "disabled" : ""}>Next</button>
    </div>
  </div>`;
}

function wirePager(total) {
  $("#campprev")?.addEventListener("click", () => { if (S.page > 0) { S.page--; paint(); } });
  $("#campnext")?.addEventListener("click", () => { if ((S.page + 1) * SIZE < total) { S.page++; paint(); } });
}

function wireRows() {
  document.querySelectorAll(".subsmore").forEach((b) =>
    b.addEventListener("click", (e) => { e.stopPropagation(); showPopover(b, S.view[Number(b.dataset.i)].pages); }));
  document.querySelectorAll(".xdel").forEach((b) =>
    b.addEventListener("click", (e) => { e.stopPropagation(); deleteCampaign(b.dataset.del); }));
  document.querySelectorAll("tr.camprow.editable[data-edit]").forEach((tr) =>
    tr.addEventListener("click", () => openEdit(tr.dataset.edit)));
}

/* ---------------- subscribers popover (body-anchored, never grows a row) ---------------- */
let popEl = null;
function closePopover() {
  if (!popEl) return;
  popEl.remove(); popEl = null;
  document.removeEventListener("click", onDocClick, true);
}
function onDocClick(e) {
  if (popEl && !popEl.contains(e.target) && !e.target.classList.contains("subsmore")) closePopover();
}
function showPopover(anchor, pages) {
  closePopover();
  popEl = document.createElement("div");
  popEl.className = "popover";
  popEl.innerHTML = pages.map((p) => `<div class="prow">${esc(p)}</div>`).join("");
  document.body.appendChild(popEl);
  const r = anchor.getBoundingClientRect();
  popEl.style.top = (r.bottom + window.scrollY + 4) + "px";
  popEl.style.left = (r.left + window.scrollX) + "px";
  setTimeout(() => document.addEventListener("click", onDocClick, true), 0);
}

/* ---------------- gate lockstep: presence in page_trend_sources = active ---------------- */
async function syncGates(pageIds) {
  const uniq = [...new Set(pageIds)].filter(Boolean);
  for (const p of uniq) {
    const on = S.rows.some((r) => r.page_id === p);
    await db("/page_trend_settings", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ page_id: p, trends_enabled: on }),
    }).catch(() => {});
  }
}

/* ---------------- delete ---------------- */
async function deleteCampaign(name) {
  const entry = S.view.find((e) => e.campaign === name);
  const pages = entry ? entry.pages.slice() : [];
  if (!confirm(`Delete campaign "${name}"? Removes ${entry ? entry.rows.length : 0} subscription row(s); those pages stop pulling this trend.`)) return;
  try {
    await db("/page_trend_sources?campaign=eq." + encodeURIComponent(name), { method: "DELETE" });
    await load();                 // refresh S.rows before deciding which gates to turn off
    await syncGates(pages);
    toast(`Campaign "${name}" deleted`);
    if (isActive("campaign")) paint();
  } catch (e) {
    toast("Delete failed: " + e.message, true);
  }
}

/* ---------------- editor ---------------- */
function knownPages() {
  const s = new Set();
  S.gates.forEach((g) => s.add(g.page_id));
  S.rows.forEach((r) => s.add(r.page_id));
  (S.editing?.extra || []).forEach((p) => s.add(p));
  return [...s];
}

function openNew() {
  S.editing = { name: "", source_name: S.sources[0]?.name || "", values: {}, pages: [], extra: [], isNew: true };
  paint();
  $("#editor")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function openEdit(name) {
  const rows = S.rows.filter((r) => r.campaign === name);
  const first = rows[0] || {};
  S.editing = {
    name, source_name: first.source_name,
    values: Object.fromEntries(COLS.map((c) => [c, first[c]])),
    pages: rows.map((r) => r.page_id), extra: [], isNew: false,
  };
  paint();
  $("#editor")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderEditor() {
  const e = S.editing;
  if (!e) return;
  const src = S.sources.find((s) => s.name === e.source_name) || S.sources[0];
  if (!src) return;

  const dead = deadCols(src);
  const fields = usedCols(src).map((c) => {
    const mode = fieldMode(src, c);
    const d = (src.defaults || {})[defKey(c)] ?? "";
    const val = e.values[c] ?? "";
    return `<label class="field">${c}
      <input type="${c === "max_results" ? "number" : "text"}" data-f="${c}" value="${esc(val)}" placeholder="${esc(d ?? "")}">
      <span class="fieldnote ${mode === "label" ? "label-only" : ""}">${mode === "fetch" ? "changes what is pulled" : "labels the event only"}</span>
    </label>`;
  }).join("");

  const pages = knownPages();
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
        <span class="fieldnote">enabled sources in trendsource.json</span>
      </label>
    </div>
    <div class="row" style="margin-bottom:6px">${fields}</div>
    <p class="hint">Not used by <span class="mono">${esc(src.name)}</span>: <span class="mono">${dead.join(", ")}</span> — M1 fills category/keywords from the platform's own response.</p>

    <h2 style="margin-top:16px">Pages</h2>
    <p class="hint">One subscription row per ticked page. Ticking a page turns its gate on; unticking removes it.</p>
    <div class="checks">
      ${pages.map((p) => `<label class="check"><input type="checkbox" data-p="${esc(p)}" ${e.pages.includes(p) ? "checked" : ""}> ${esc(p)}</label>`).join("") || `<span class="empty">No pages yet — add one below.</span>`}
    </div>
    <div class="row" style="margin-top:10px">
      <input type="text" id="newpage" placeholder="add page_id">
      <button class="btn ghost" id="addpage">Add page</button>
    </div>

    <div class="row" style="margin-top:16px">
      <button class="btn" id="save">Save campaign</button>
      <button class="btn ghost" id="cancel">Cancel</button>
    </div>
  </div>`;

  $("#csrc").addEventListener("change", (ev) => { e.source_name = ev.target.value; e.values = {}; renderEditor(); });
  document.querySelectorAll("[data-f]").forEach((el) => el.addEventListener("input", () => (e.values[el.dataset.f] = el.value)));
  document.querySelectorAll("[data-p]").forEach((el) => el.addEventListener("change", () => {
    const p = el.dataset.p;
    e.pages = el.checked ? [...new Set([...e.pages, p])] : e.pages.filter((x) => x !== p);
  }));
  $("#addpage").addEventListener("click", () => {
    const id = $("#newpage").value.trim();
    if (!id) return;
    if (!e.extra.includes(id)) e.extra.push(id);
    if (!e.pages.includes(id)) e.pages.push(id);
    renderEditor();
  });
  $("#cancel").addEventListener("click", () => { S.editing = null; paint(); });
  $("#save").addEventListener("click", saveCampaign);
}

async function saveCampaign() {
  const e = S.editing;
  if (e.saving) return;
  const name = (e.isNew ? $("#cname").value : e.name).trim();
  if (!name) return toast("Campaign needs a name", true);
  if (!e.pages.length) return toast("Tick at least one page", true);
  if (e.isNew && S.rows.some((r) => r.campaign === name)) return toast("That campaign name already exists", true);

  const src = S.sources.find((s) => s.name === e.source_name);
  if (!src) return toast(`Source "${e.source_name}" is no longer in the catalog`, true);

  const prevPages = S.rows.filter((r) => r.campaign === name).map((r) => r.page_id);
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
  const btn = $("#save"); if (btn) btn.disabled = true;
  try {
    // INSERT-first, then delete only the stale rows by id: worst failure is a visible
    // duplicate, never a wiped campaign (the old DELETE-then-POST order could wipe it).
    const inserted = await db("/page_trend_sources", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(rows),
    });
    const keep = (inserted || []).map((r) => r.id);
    if (!keep.length) throw new Error("insert returned no rows — old rows left untouched");
    await db(`/page_trend_sources?campaign=eq.${encodeURIComponent(name)}&id=not.in.(${keep.join(",")})`, { method: "DELETE" });

    await load();                                   // fresh state before gate sync
    await syncGates([...new Set([...e.pages, ...prevPages])]);
    toast(`Campaign "${name}" saved — ${rows.length} page(s)`);
    S.editing = null;
    if (isActive("campaign")) paint();
  } catch (err) {
    toast("Save failed: " + err.message, true);
  } finally {
    e.saving = false;
    if (btn) btn.disabled = false;
  }
}
