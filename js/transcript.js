export function mergePartial(current, incoming) {
  const rawExisting = String(current || "");
  const rawNext = String(incoming || "");
  const existing = rawExisting.trim();
  const next = rawNext.trim();
  if (!existing) return next;
  if (!next) return existing;
  if (next.startsWith(existing)) return next;
  if (existing.endsWith(next)) return existing;
  const hadBoundarySpace = /\s$/.test(rawExisting) || /^\s/.test(rawNext);
  const needsSpace = hadBoundarySpace
    && /[A-Za-z0-9,.;:!?'"’”)]$/.test(existing)
    && /^[A-Za-z0-9('"‘“]/.test(next);
  return existing + (needsSpace ? " " : "") + next;
}
