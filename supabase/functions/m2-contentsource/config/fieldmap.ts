// Applies a source's field_map to one platform item, producing standard fields.
// Identical helper to the m1-trend field mapper.

type Spec = string | string[] | { const: string } | Record<string, string>;

export function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  return String(path).split(".").reduce<unknown>(
    (o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]),
    obj,
  );
}

function empty(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

export function mapField(item: unknown, spec: Spec | undefined): unknown {
  if (spec == null) return undefined;
  if (typeof spec === "string") return getPath(item, spec);
  // Fallback chain: ["images.0", "video_thumbnail"] -> first path that resolves wins.
  // Exists because one platform can split the same concept across post types: a LinkedIn
  // image post fills `images` and leaves video_thumbnail null, a video post does the
  // reverse, and there is no single shared path (Facebook only escaped this because
  // attachments.0.url happens to cover both). Must be checked BEFORE the object branches —
  // an array IS an object, so "const" in spec / Object.entries would misread it.
  if (Array.isArray(spec)) {
    for (const p of spec) {
      const v = getPath(item, p);
      if (!empty(v)) return v;
    }
    return undefined;
  }
  if ("const" in spec) return (spec as { const: string }).const;
  // Composite spec: map each key's dot-path into one object.
  // e.g. "engagement": { "likes": "likes", "comments": "num_comments", "shares": "num_shares" }
  const out: Record<string, unknown> = {};
  for (const [k, path] of Object.entries(spec)) out[k] = getPath(item, path);
  return out;
}
