// Applies a source's field_map to one platform item, producing standard fields.
// Identical helper to the m1-trend field mapper.

type Spec = string | { const: string } | Record<string, string>;

export function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  return String(path).split(".").reduce<unknown>(
    (o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]),
    obj,
  );
}

export function mapField(item: unknown, spec: Spec | undefined): unknown {
  if (spec == null) return undefined;
  if (typeof spec === "string") return getPath(item, spec);
  if ("const" in spec) return (spec as { const: string }).const;
  // Composite spec: map each key's dot-path into one object.
  // e.g. "engagement": { "likes": "likes", "comments": "num_comments", "shares": "num_shares" }
  const out: Record<string, unknown> = {};
  for (const [k, path] of Object.entries(spec)) out[k] = getPath(item, path);
  return out;
}
