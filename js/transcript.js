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

// Keep incomplete tool frames private while Live transcription is still streaming.
export function stripToolResponses(text, { final = false } = {}) {
  let output = "";
  let cursor = 0;
  const frame = /\bresponse\s*:\s*[a-zA-Z_]\w*\s*\{/g;
  for (let match; (match = frame.exec(text));) {
    output += text.slice(cursor, match.index);
    let depth = 1, quote = false, escaped = false;
    let end = frame.lastIndex;
    for (; end < text.length && depth; end += 1) {
      const char = text[end];
      if (escaped) { escaped = false; continue; }
      if (quote && char === "\\") { escaped = true; continue; }
      if (char === '"') quote = !quote;
      if (!quote) {
        if (char === "{") depth += 1;
        if (char === "}") depth -= 1;
      }
    }
    if (depth) return output.trim();
    cursor = end;
    frame.lastIndex = end;
  }
  output += text.slice(cursor);
  // A prefix may arrive separately from the tool name and response body.
  if (final) return output.replace(/\bresponse\s*:\s*[\w]*\s*$/, "").trim();
  return output.replace(/\b(?:r|re|res|resp|respo|respon|respons|response)(?:\s*:\s*[\w]*)?\s*$/, "").trim();
}
