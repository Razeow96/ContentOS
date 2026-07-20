/* Content OS · Admin — presentation kit (reusable, domain-agnostic).
 * The shared "templates": DOM helpers + the table shell + toast/banner. Screens
 * import these and compose them with their own domain data. Knows nothing about
 * M0/M1/M2/M3.
 */

export const $ = (sel) => document.querySelector(sel);

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const fmtTs = (ts, from = 0, to = 16) => String(ts || "").slice(from, to).replace("T", " ");

// Reusable page header: <h1> + a FIXED 2-line description (design rule 6), so
// every page's card + table start at the same Y regardless of description length.
// title/desc are trusted HTML strings (screens author them, e.g. with <span class="mono">).
export function pageHeader(title, desc) {
  return `<h1>${title}</h1><p class="sub">${desc || ""}</p>`;
}

// Table shell with the empty-state fallback; colspan derived from the headers so it
// can never drift when a column is added. A header is a string or {h, w}.
export function table(cols, rowsHtml, empty) {
  const ths = cols.map((c) => (typeof c === "string" ? `<th>${c}</th>` : `<th style="width:${c.w}">${c.h}</th>`)).join("");
  return `<div class="tablewrap"><table>
    <tr>${ths}</tr>
    ${rowsHtml || `<tr><td colspan="${cols.length}" class="empty">${empty || ""}</td></tr>`}
  </table></div>`;
}

// Paginated table body: renders the real rows, then pads with blank filler rows
// up to `size` so the table box never changes height between pages (design rule
// 4). `rows` is an ARRAY of <tr> strings. Empty state also fills to full height.
export function pagedBody(colCount, rows, empty, size = 10) {
  // filler cells mirror the mono data cells so their line-box (and row height)
  // matches exactly — otherwise sans fillers are ~1px shorter and the box drifts.
  const filler = `<tr class="filler">${'<td class="mono">&nbsp;</td>'.repeat(colCount)}</tr>`;
  if (rows.length === 0) {
    return `<tr><td colspan="${colCount}" class="empty">${empty || ""}</td></tr>` + filler.repeat(size - 1);
  }
  return rows.join("") + filler.repeat(Math.max(0, size - rows.length));
}

let toastTimer = null;
export function toast(msg, bad) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (bad ? " bad" : "");
  clearTimeout(toastTimer); // a stale timer from an earlier toast must not hide this one
  toastTimer = setTimeout(() => t.classList.add("hidden"), 3800);
}

export function banner(html, bad) {
  const b = $("#banner");
  if (!html) return b.classList.add("hidden");
  b.className = "banner" + (bad ? " bad" : "");
  b.innerHTML = html;
}
