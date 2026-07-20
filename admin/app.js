/* Content OS · Admin — observability console. Router + boot only.
 *
 * Left nav = the domain architecture (top→bottom). Each domain expands to a
 * mini-menu of screens. Only Infrastructure is wired for now — { Logs, Rate-limit },
 * both ecosystem-wide. Other domains land later, one UXUI at a time.
 *
 * Screens live in pages/<domain>/*.js and draw from the shared kits in lib/.
 * The dropped config screens (m1-trend / m2-source / m3-drafts) still sit in
 * pages/ unwired — re-add them as domain screens when their UXUI is ready.
 */

import { $, banner } from "./lib/ui.js";
import { CFG, REST, db } from "./lib/api.js";
import { nav } from "./lib/nav.js";

import * as logs from "./pages/infastructure/m0-logs.js";
import * as ratelimit from "./pages/infastructure/m0-ratelimit.js";
import * as campaign from "./pages/trend/campaign.js";
import * as trendfeed from "./pages/trend/trend-feed.js";

const SCREENS = {
  logs: logs.render,
  ratelimit: ratelimit.render,
  campaign: campaign.render,
  "trend-feed": trendfeed.render,
};

function render() {
  document.querySelectorAll(".navitem").forEach((b) => b.classList.toggle("active", b.dataset.screen === nav.screen));
  (SCREENS[nav.screen] || logs.render)();
}

// Domain rows expand/collapse their sub-menu.
document.querySelectorAll(".navdomain").forEach((b) =>
  b.addEventListener("click", () => {
    b.classList.toggle("expanded");
    document.querySelector(`.navsub[data-sub="${b.dataset.domain}"]`)?.classList.toggle("collapsed");
  })
);

// Sub-menu items select a screen.
document.querySelectorAll(".navitem").forEach((b) =>
  b.addEventListener("click", () => { nav.screen = b.dataset.screen; render(); })
);

(async () => {
  const conn = $("#conn");
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_KEY) {
    conn.textContent = "config.js missing";
    conn.className = "conn bad";
    return banner(`<strong>No config.js.</strong> Copy <span class="mono">config.example.js</span> to <span class="mono">config.js</span> and put your Supabase URL + service_role key in it. It is gitignored.`, true);
  }
  try {
    await db("/run_log?select=id&limit=1"); // connectivity probe
    render();
    conn.textContent = "connected · " + REST.replace("https://", "").split(".")[0];
    conn.className = "conn ok";
  } catch (e) {
    conn.textContent = "connection failed";
    conn.className = "conn bad";
    render(); // still paint — the screen shows its own error detail
    banner(
      `<strong>Could not load.</strong> <span class="mono">${e.message}</span><br><br>
       Serve from the <strong>repo root</strong> (not inside <span class="mono">admin/</span>), and use the <span class="mono">service_role</span> key in config.js — these tables are RLS-protected.`,
      true,
    );
  }
})();
