/* Content OS · Admin — nav/router shared state.
 * Tiny module both the router (app.js) and every screen import, so screens can
 * check "am I still the active screen?" (stale-response guard) and trigger a
 * global re-render WITHOUT importing app.js (no circular deps).
 */

export const nav = { screen: "logs" };

// Stale-response guard helper: a slow fetch must never paint over another screen.
export const isActive = (screen) => nav.screen === screen;

// The router registers its render() here; screens call rerender() after a write
// that should refresh the current screen + the global banner.
let _rerender = () => {};
export function onRerender(fn) { _rerender = fn; }
export function rerender() { _rerender(); }
