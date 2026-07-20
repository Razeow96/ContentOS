/* Drafts screen (M3 · content_items, RAZ-60) — read-only review surface for
 * generated drafts. The validator FLAGS are the point — shown up front, not
 * buried. Edit / approve / schedule is the owner's manual DB loop for now.
 */

import { db } from "../lib/api.js";
import { $, esc, fmtTs, table } from "../lib/ui.js";
import { isActive } from "../lib/nav.js";

const drafts = { status: "draft", page: "", pillar: "", seq: 0, rows: [], pages: [], pillars: [], expanded: null };

function flagTags(v) {
  const f = (v && v.flags) || [];
  if (!f.length) return `<span class="tag on">clean</span>` + (v && v.revised ? ` <span class="tag">revised</span>` : "");
  const label = { range_violation: "range", pattern_violation: "dash", lexicon_violation: "word-DNA" };
  return f.map((x) => `<span class="tag warn">${esc(label[x] || x)}</span>`).join(" ") + (v && v.revised ? ` <span class="tag">revised</span>` : "");
}

export async function render(reuse) {
  const seq = ++drafts.seq;
  const stale = () => seq !== drafts.seq || !isActive("drafts");
  let rows = [];
  try {
    if (!reuse || !drafts.pages.length) {
      const meta = await db("/content_items?select=page_id,pillar_id&limit=1000").catch(() => []);
      drafts.pages = [...new Set((meta || []).map((r) => r.page_id))];
      drafts.pillars = [...new Set((meta || []).map((r) => r.pillar_id))];
    }
    let q = `/content_items?select=*&order=created_at.desc&limit=200`;
    if (drafts.status !== "all") q += `&status=eq.${encodeURIComponent(drafts.status)}`;
    if (drafts.page) q += `&page_id=eq.${encodeURIComponent(drafts.page)}`;
    if (drafts.pillar) q += `&pillar_id=eq.${encodeURIComponent(drafts.pillar)}`;
    rows = await db(q);
  } catch (e) {
    if (stale()) return;
    return ($("#screen").innerHTML = `<h1>Drafts</h1>
      <div class="card"><h2>content_items unavailable</h2><p class="hint mono">${esc(e.message).slice(0, 200)}</p></div>`);
  }
  if (stale()) return;
  drafts.rows = rows;

  const rowHtml = (r) => {
    const yr = r.movie_year ? `（${r.movie_year}）` : "";
    return `<tr class="draftrow" data-id="${r.id}" style="cursor:pointer">
        <td class="mono">${esc(fmtTs(r.created_at, 5, 16))}</td>
        <td class="mono">${esc(r.page_id)}</td>
        <td class="mono">${esc(r.pillar_id)}</td>
        <td>${esc(String(r.angle_entity ?? "—"))}${esc(yr)}</td>
        <td class="mono">${(r.validation && r.validation.char_count) ?? "—"}</td>
        <td>${flagTags(r.validation)}</td>
      </tr>` + (drafts.expanded === r.id ? `<tr><td colspan="6" style="background:var(--panel-2)">${draftBody(r)}</td></tr>` : "");
  };

  $("#screen").innerHTML = `<h1>Drafts</h1>
    <p class="sub">M3 <span class="mono">content_items</span> — generated drafts + validator flags (RAZ-60). Read-only; the edit / schedule loop stays in the DB for now.</p>
    <div class="card">
      <div class="spread"><h2>Drafts <span class="count">${rows.length}</span></h2>
        <div class="row">
          <select id="dstatus">
            ${["draft", "all"].map((s) => `<option value="${s}" ${drafts.status === s ? "selected" : ""}>${s === "all" ? "all statuses" : s}</option>`).join("")}
          </select>
          <select id="dpage"><option value="">all pages</option>
            ${drafts.pages.map((p) => `<option value="${esc(p)}" ${drafts.page === p ? "selected" : ""}>${esc(p)}</option>`).join("")}
          </select>
          <select id="dpillar"><option value="">all pillars</option>
            ${drafts.pillars.map((p) => `<option value="${esc(p)}" ${drafts.pillar === p ? "selected" : ""}>${esc(p)}</option>`).join("")}
          </select>
          <button class="btn ghost" id="drefresh">Refresh</button>
        </div>
      </div>
      <p class="hint">Flags: <span class="tag warn">range</span>/<span class="tag warn">dash</span>/<span class="tag warn">word-DNA</span> = validator caught it · <span class="tag on">clean</span> = passed · <span class="tag">revised</span> = auto-revise ran. Click a row for the full caption + evidence.</p>
      ${
    table(
      ["Created", "Page", "Pillar", "Angle", "Chars", "Flags"],
      rows.map(rowHtml).join(""),
      "No drafts. Once the M3 consumer is live (RAZ-50), SourceEnriched events land here.",
    )
  }
    </div>`;

  $("#dstatus").addEventListener("change", (e) => { drafts.status = e.target.value; drafts.expanded = null; render(true); });
  $("#dpage").addEventListener("change", (e) => { drafts.page = e.target.value; drafts.expanded = null; render(true); });
  $("#dpillar").addEventListener("change", (e) => { drafts.pillar = e.target.value; drafts.expanded = null; render(true); });
  $("#drefresh").addEventListener("click", () => render());
  document.querySelectorAll(".draftrow").forEach((el) =>
    el.addEventListener("click", () => {
      const id = Number(el.dataset.id);
      drafts.expanded = drafts.expanded === id ? null : id;
      render(true);
    })
  );
}

function draftBody(r) {
  const d = r.draft || {};
  const ev = (r.evidence || []).map((e) =>
    `<li>${esc((e.claim || "").slice(0, 160))}${e.url ? ` — <a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.source || "link")}</a>` : ""}</li>`).join("");
  const media = (r.media_refs || []).filter((m) => m.url)
    .map((m) => `<img src="${esc(m.url)}" alt="" style="width:70px;height:40px;object-fit:cover;border-radius:3px;margin-right:6px">`).join("");
  return `<div style="padding:10px 6px;max-width:820px">
    ${d.title ? `<div style="font-weight:600;margin-bottom:6px">${esc(d.title)}</div>` : ""}
    <div style="white-space:pre-wrap;line-height:1.7">${esc(d.copy || "")}</div>
    ${(d.hashtags && d.hashtags.length) ? `<div class="hint mono" style="margin-top:8px">${esc(d.hashtags.join(" "))}</div>` : ""}
    ${r.image_prompt ? `<p class="hint" style="margin-top:8px"><strong>image prompt:</strong> ${esc(r.image_prompt)}</p>` : ""}
    ${media ? `<div style="margin-top:8px">${media}</div>` : ""}
    ${ev ? `<div class="hint" style="margin-top:8px"><strong>evidence</strong><ul style="margin:4px 0 0 16px">${ev}</ul></div>` : ""}
    <p class="hint mono" style="margin-top:8px">correlation_id: ${esc(r.correlation_id || "—")}</p>
  </div>`;
}
