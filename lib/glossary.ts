import { prisma } from "@/lib/prisma";

export type GlossaryTermRecord = {
  id: string;
  term: string;
  commonMistakes: string[];
  definition?: string;
};

/** Split comma-separated mishearing list; empty segments dropped. */
export function parseCommonMistakes(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Serialize mishearings for DB storage. */
export function serializeCommonMistakes(mistakes: string[]): string {
  return mistakes.map((m) => m.trim()).filter(Boolean).join(", ");
}

export function toGlossaryTermRecord(row: {
  id: string;
  term: string;
  commonMistakes: string;
  definition?: string | null;
}): GlossaryTermRecord {
  const definition = row.definition?.trim();
  return {
    id: row.id,
    term: row.term.trim(),
    commonMistakes: parseCommonMistakes(row.commonMistakes),
    ...(definition ? { definition } : {}),
  };
}

export async function loadAllGlossaryTerms(): Promise<GlossaryTermRecord[]> {
  const rows = await prisma.glossaryTerm.findMany({
    orderBy: { term: "asc" },
    select: { id: true, term: true, commonMistakes: true, definition: true },
  });
  return rows.map(toGlossaryTermRecord);
}

function normalizeForMatch(text: string): string {
  return text.toLowerCase();
}

function appearsInText(haystack: string, needle: string): boolean {
  const n = needle.trim();
  if (!n) return false;
  return normalizeForMatch(haystack).includes(normalizeForMatch(n));
}

/** Significant words from a multi-word glossary phrase for loose chunk matching. */
function termMatchTokens(term: string): string[] {
  return term
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, j) => j);
  let curr = new Array<number>(cols);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

function maxEditDistanceForLength(len: number): number {
  if (len <= 4) return 1;
  if (len <= 7) return 2;
  return Math.max(2, Math.floor(len * 0.25));
}

/** True when two words differ by at most a small edit distance for their length. */
function isFuzzySimilar(word: string, candidate: string): boolean {
  const a = normalizeForMatch(word);
  const b = normalizeForMatch(candidate);
  if (!a || !b) return false;
  if (a === b) return true;

  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  if (minLen < 3) return false;

  const maxDist = maxEditDistanceForLength(maxLen);
  if (maxLen - minLen > maxDist) return false;

  return levenshteinDistance(a, b) <= maxDist;
}

function extractChunkWords(text: string): string[] {
  return text
    .split(/[^a-zA-Z0-9\u00C0-\u024F]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

function collectMatchCandidates(entry: GlossaryTermRecord): string[] {
  const candidates = new Set<string>();
  const add = (value: string) => {
    const trimmed = value.trim();
    if (trimmed) candidates.add(trimmed);
  };

  add(entry.term);
  for (const token of termMatchTokens(entry.term)) add(token);
  for (const mistake of entry.commonMistakes) {
    add(mistake);
    for (const token of termMatchTokens(mistake)) add(token);
  }

  return [...candidates];
}

function entryMatchesChunk(
  entry: GlossaryTermRecord,
  chunkText: string,
  chunkWords: string[]
): boolean {
  if (appearsInText(chunkText, entry.term)) return true;
  if (entry.commonMistakes.some((mistake) => appearsInText(chunkText, mistake))) {
    return true;
  }

  const candidates = collectMatchCandidates(entry);
  for (const word of chunkWords) {
    for (const candidate of candidates) {
      if (isFuzzySimilar(word, candidate)) return true;
    }
  }

  return false;
}

/**
 * Relevant if the chunk contains the correct term, a listed mishearing, or a word
 * fuzzy-close to the term (or its tokens / mistake variants).
 */
export function filterRelevantGlossaryTerms(
  terms: GlossaryTermRecord[],
  chunkText: string
): GlossaryTermRecord[] {
  if (!chunkText.trim() || terms.length === 0) return [];
  const chunkWords = extractChunkWords(chunkText);
  return terms.filter((entry) => entryMatchesChunk(entry, chunkText, chunkWords));
}

function buildKnownCorrectionsSection(terms: GlossaryTermRecord[]): string {
  if (terms.length === 0) return "";

  const lines = terms.map((entry) => {
    const mistakes = entry.commonMistakes.filter(Boolean);
    const definitionNote = entry.definition
      ? ` Makna/konteks: ${entry.definition}.`
      : "";
    if (mistakes.length === 0) {
      return `- Ejaan benar: "${entry.term}". Bandingkan fonetik seluruh transkrip; jika ada kata/frasa yang menyerupai istilah ini, koreksi ke ejaan ini.${definitionNote}`;
    }
    const mistakeList = mistakes.map((m) => `"${m}"`).join(", ");
    return `- Ejaan benar: "${entry.term}". Contoh kesalahan transkripsi yang diketahui: ${mistakeList} — koreksi pola-pola persis ini dengan tegas; tetap gunakan penilaian fonetik untuk variasi lain yang menyerupai "${entry.term}".${definitionNote}`;
  });

  return [
    "KOREKSI TRANSKRIPSI TERSIMBAN (referensi ejaan benar — terapkan mekanisme dua lapis seperti di instruksi KOREKSI TRANSKRIPSI):",
    ...lines,
  ].join("\n");
}

export type GlossaryContext = {
  allTerms: GlossaryTermRecord[];
  /** Optional per-request terms from the upload form (comma-separated). */
  perRequest?: string;
};

/**
 * Build the glossary appendix for one summarizeWithGroq call: per-request terms plus
 * chunk-relevant global corrections only (exact or fuzzy-matched against chunk text).
 */
export function resolveGlossaryForContent(
  allTerms: GlossaryTermRecord[],
  content: string,
  perRequestGlossary?: string
): string | undefined {
  const parts: string[] = [];

  const perRequest = perRequestGlossary?.trim();
  if (perRequest) {
    parts.push(
      `ISTILAH TEKNIS KHUSUS (pertahankan ejaan persis seperti ini, jangan ubah atau terjemahkan): ${perRequest}`
    );
  }

  const relevant = filterRelevantGlossaryTerms(allTerms, content);
  const corrections = buildKnownCorrectionsSection(relevant);
  if (corrections) parts.push(corrections);

  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export function resolveGlossaryFromContext(
  context: GlossaryContext | undefined,
  content: string
): string | undefined {
  if (!context) return undefined;
  return resolveGlossaryForContent(
    context.allTerms,
    content,
    context.perRequest
  );
}
