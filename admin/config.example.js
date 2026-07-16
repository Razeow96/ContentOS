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
};
