/* Content OS · Admin — Supabase Realtime (true push).
 * supabase-js is loaded LAZILY from a CDN the first time a screen subscribes, so
 * a CDN hiccup only disables live push — it never breaks the app's module graph
 * or the initial fetch. INSERT streaming only (default replica identity is enough).
 */

import { CFG } from "./api.js";

let clientPromise = null;
function getClient() {
  if (!clientPromise) {
    clientPromise = import("https://esm.sh/@supabase/supabase-js@2").then(({ createClient }) =>
      createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, { realtime: { params: { eventsPerSecond: 5 } } })
    );
  }
  return clientPromise;
}

// Subscribe to INSERTs on a public table; cb() fires on each new row.
// Returns an unsubscribe function. Best-effort: any failure is logged, not thrown.
export function onInserts(table, cb) {
  let ch = null, dead = false;
  getClient()
    .then((client) => {
      if (dead) return;
      ch = client
        .channel(`rt:${table}:${Date.now()}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table }, () => cb())
        .subscribe();
    })
    .catch((e) => console.error("realtime load failed:", e?.message || e));
  return () => {
    dead = true;
    if (ch) getClient().then((c) => c.removeChannel(ch)).catch(() => {});
  };
}
