# /admin — Design Learn Rules (BINDING)

**Read this file BEFORE making ANY design change inside `/admin`.** These are owner rules (2026-07-20), and they apply to **every** screen — current and future. When you add a domain screen, it must already obey all of them. They are enforced in the shared kit (`lib/ui.js` + `style.css`) so following the existing pattern gets them for free — don't hand-roll a table or nav that bypasses them.

---

## 1. Left menu — domain list, collapsed
- The left menu **is the 10-domain architecture**, top → bottom (Infrastructure, Trend, Content Source, Generation, …).
- Only the **domain name** is visible by default. Domains are **collapsed** — no sub-items showing until clicked.
- Markup: `<button class="navdomain" data-domain="…">Name</button>` + a sibling `<div class="navsub collapsed" data-sub="…">`.

## 2. Left menu — dropdown
- Clicking a domain **expands a dropdown** of its screens (sub-items); clicking again collapses. The caret rotates (`.navdomain.expanded`).
- Sub-items are **smaller font** than the domain, indented under it (`.navsub .navitem`, 12px).
- Sub-items set the screen: `<button class="navitem" data-screen="…">`.

## 3. Rows cap at 10
- **Every table paginates at 10 rows per page.** Never dump more than 10 rows.
- Pager sits bottom of the table: **`page X of N · total`** on the left, **Prev / Next** on the right (`.pager`).
- Fetch with `dbPaged(path, page, size)` (returns `{ rows, total }` via `count=exact`).

## 4. Rows box stays a constant height (filler rows)
- The table box **never changes height between pages.** With fewer than 10 real rows, pad with **blank filler rows** up to 10 so the box — and the pager below it — stay put.
- Enforced by `pagedBody(colCount, rowsArray, emptyMsg, 10)` in `lib/ui.js`. Build rows as an **array** and pass it through this; do not `.join("")` yourself.
- The empty state also fills to full height (message in row 1, fillers below).

## 5. All cell text is ONE consistent size, and never wraps
- Every data cell (`<td>`) across every column renders at the **same font size** (`12.5px`, set on `td` and `td .mono` in `style.css`). No mixing sizes for plain text.
- **Cells never wrap.** A wrapped cell makes rows different heights on different pages (the date-column bug: `2026-07-20` wrapping to two lines). `td { white-space: nowrap }` is global; long text (note / url) **ellipsizes** via a per-column `max-width` + `overflow:hidden` + `text-overflow:ellipsis` — it does not wrap.
- Column headers (`th`) keep their small-uppercase label style — rule 5 governs the data cells. Status chips (`.tag`) keep their chip styling; they are indicators, not text.

## 6. Consistent table placement (fixed header + card structure, full width)
Every page's table must start at the **same vertical position**, whatever the text length.
- **Page header is a fixed 2-line block.** Use `pageHeader(title, description)` (`lib/ui.js`). The description reserves **exactly 2 lines** (`.sub`) — short text leaves a blank 2nd line; long text **clamps with …**, it never pushes the table down.
- **Every card has the same structure:** header row (title + count + controls) → **fixed-height `.cardhint` slot** (one line, present on every card, **blank when the page has nothing to say**) → the table. So the table's Y is identical across pages.
- **Full width.** Text and tables use the whole content area — no artificial `max-width` that wraps a description to a 2nd line while space sits empty to the right. `.main` is full width; the table is `width:100%`.

---

### Where the rules live (reuse, don't re-implement)
- Nav (1, 2): `index.html` markup + `.navdomain/.navsub` in `style.css` + the toggle wiring in `app.js`.
- Pagination (3): `dbPaged` in `lib/api.js`, the `pager()` + `.pager` pattern in each screen.
- Constant height (4): `pagedBody()` in `lib/ui.js`.
- Font/no-wrap (5): the `td` rules in `style.css`.
- Placement (6): `pageHeader()` in `lib/ui.js` + `.sub` / `.cardhint` / `.main` rules in `style.css`. Always emit a `.cardhint` div in every card (blank if unused).

A new screen that uses `pageHeader()` → a card with a `.cardhint` slot → `dbPaged` → `pagedBody` → `table()`, plus the nav classes above, complies with all six by construction.
