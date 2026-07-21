export function mergePartial(current, incoming) {
  const existing = String(current || "").trim();
  const next = String(incoming || "").trim();
  if (!existing) return next;
  if (!next) return existing;
  if (next.startsWith(existing)) return next;
  if (existing.endsWith(next)) return existing;
  return existing + next;
}
