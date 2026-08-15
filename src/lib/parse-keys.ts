/**
 * Steam key parsing. Steam keys are groups of 5 uppercase alphanumerics
 * separated by hyphens: usually 3 groups (XXXXX-XXXXX-XXXXX), sometimes 4 or 5.
 * Steam does not expose any API to inspect or validate an unredeemed key, so
 * all we can do is recognise the shape and dedupe.
 */

export const KEY_REGEX = /\b([A-Z0-9]{5}(?:-[A-Z0-9]{5}){2,4})\b/gi;

export type ParsedKey = {
  key: string; // normalised (uppercase)
  line: number; // 1-based line number in the source
  context: string; // leftover text on the same line (label, email, etc.)
};

export type ParseResult = {
  keys: ParsedKey[]; // unique keys, first occurrence wins
  duplicateLines: number; // keys that appeared more than once in the input
  ignoredLines: number; // non-empty lines with no key on them
  totalLines: number;
};

export function parseKeysFromText(text: string): ParseResult {
  const lines = text.split(/\r?\n/);
  const seen = new Set<string>();
  const keys: ParsedKey[] = [];
  let duplicateLines = 0;
  let ignoredLines = 0;

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    const matches = [...line.matchAll(KEY_REGEX)];
    if (matches.length === 0) {
      ignoredLines += 1;
      return;
    }
    // Context = the line with keys removed, trimmed of separators.
    const context = line
      .replace(KEY_REGEX, "")
      .replace(/^[\s,;:|\t"'-]+|[\s,;:|\t"'-]+$/g, "")
      .trim();
    for (const m of matches) {
      const key = m[1].toUpperCase();
      if (seen.has(key)) {
        duplicateLines += 1;
        continue;
      }
      seen.add(key);
      keys.push({ key, line: idx + 1, context });
    }
  });

  return { keys, duplicateLines, ignoredLines, totalLines: lines.length };
}

export type FilenameMeta = {
  suggestedName: string;
  packageId?: number;
  expectedCount?: number;
};

/**
 * Steamworks partner exports are named like
 *   The_Boundary_for_Beta_Testing_pkg1772375_start0_num100.txt
 * Pull the human name / package id / count out of that when present.
 */
export function parseFilename(filename: string): FilenameMeta {
  const base = filename.replace(/\.[a-z0-9]+$/i, "");
  const m = base.match(/^(.*?)_pkg(\d+)_start\d+_num(\d+)$/i);
  if (m) {
    return {
      suggestedName: m[1].replace(/_/g, " ").trim(),
      packageId: Number(m[2]),
      expectedCount: Number(m[3]),
    };
  }
  return { suggestedName: base.replace(/[_-]+/g, " ").trim() };
}
