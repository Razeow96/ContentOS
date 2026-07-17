/* Copy to config.js (gitignored) and fill in.
 *
 * Use the SERVICE_ROLE key. The page_* config tables are RLS-protected: the anon
 * key reads back zero rows and cannot write, so the UI is useless with it.
 *
 * That key bypasses RLS entirely — which is exactly why this app is local-only,
 * never deployed, and config.js is gitignored. Do not paste it anywhere else.
 * Get it with:  supabase projects api-keys --project-ref <ref>
 */
window.CONTENT_OS_CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT_REF.supabase.co",
  SUPABASE_KEY: "YOUR_SERVICE_ROLE_KEY",

  // Content Source screen · async keyword discovery only (RAZ-37).
  // Bright Data discover jobs take minutes and cannot answer inside the edge function's
  // sync budget, so the browser hands the planned job to the n8n Harvest Worker and the
  // results land in the review queue later. No secret here — it is a webhook URL.
  // The worker must be ACTIVE for this path to accept requests.
  HARVEST_WORKER_URL: "https://YOUR_N8N_HOST/webhook/m2-harvest-worker",
};
