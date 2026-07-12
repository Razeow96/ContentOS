// Applies a source's field_map to one platform item, producing standard fields.
 
type Spec = string | { const: string };
 
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  return String(path).split(".").reduce<unknown>(
    (o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]),
    obj,
  );
}
 
export function mapField(item: unknown, spec: Spec | undefined): unknown {
  if (spec && typeof spec === "object" && "const" in spec) return spec.const;
  if (typeof spec === "string") return getPath(item, spec);
  return undefined;
}