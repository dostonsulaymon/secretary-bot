import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Personal knowledge base: facts the bot may rely on, plus canned guidance for
 * common questions. Loaded at startup from facts.json (falls back to
 * facts.example.json) into in-memory arrays that are the source of truth;
 * mutations persist back to facts.json so the owner can edit by DMing the bot.
 */

export interface FaqEntry {
  q: string;
  a: string;
}

interface FactsFile {
  facts?: string[];
  faq?: FaqEntry[];
}

const FACTS_PATH = join(process.cwd(), "facts.json");

function loadFactsFile(): FactsFile {
  for (const name of ["facts.json", "facts.example.json"]) {
    try {
      const raw = readFileSync(join(process.cwd(), name), "utf8");
      return JSON.parse(raw) as FactsFile;
    } catch {
      // not found / unreadable — try the next candidate
    }
  }
  console.warn("No facts file found — the bot will deflect factual questions.");
  return {};
}

const file = loadFactsFile();
const facts: string[] = file.facts ?? [];
const faq: FaqEntry[] = file.faq ?? [];

/** Compose the knowledge-base section of the system prompt (call per message — facts can change at runtime). */
export function buildFactsContext(): string {
  const sections: string[] = [];

  if (facts.length) {
    sections.push(
      "Facts about you — you may use these to answer, but never state anything beyond them as fact:\n" +
        facts.map((f) => `- ${f}`).join("\n"),
    );
  }

  if (faq.length) {
    sections.push(
      "Guidance for common questions:\n" +
        faq.map((e) => `- If asked "${e.q}" → ${e.a}`).join("\n"),
    );
  }

  // Always present, even with no facts file: hard guard against inventing personal details.
  sections.push(
    "If you're asked anything personal or factual that is NOT covered above — relationships, " +
      "family, marital status, address, finances, health, future plans — do NOT confirm, deny, " +
      'or guess. Deflect lightly (e.g. "why do you ask?") or say you\'ll follow up later. Never ' +
      "present an unverified detail as fact.",
  );

  return sections.join("\n\n");
}

// --- Owner-facing mutations (persist to disk) ---

export function listFacts(): string[] {
  return facts;
}

export function listFaq(): FaqEntry[] {
  return faq;
}

export function addFact(text: string): void {
  facts.push(text.trim());
  persist();
}

export function addFaq(question: string, answer: string): void {
  faq.push({ q: question.trim(), a: answer.trim() });
  persist();
}

/** Remove any fact or FAQ entry whose text contains `match` (case-insensitive). Returns what was removed. */
export function removeKnowledge(match: string): string[] {
  const needle = match.trim().toLowerCase();
  if (!needle) return [];
  const removed: string[] = [];

  for (let i = facts.length - 1; i >= 0; i--) {
    const f = facts[i];
    if (f && f.toLowerCase().includes(needle)) {
      removed.push(f);
      facts.splice(i, 1);
    }
  }
  for (let i = faq.length - 1; i >= 0; i--) {
    const e = faq[i];
    if (e && (e.q.toLowerCase().includes(needle) || e.a.toLowerCase().includes(needle))) {
      removed.push(`FAQ: "${e.q}"`);
      faq.splice(i, 1);
    }
  }

  if (removed.length) persist();
  return removed;
}

function persist(): void {
  writeFileSync(FACTS_PATH, JSON.stringify({ facts, faq }, null, 2) + "\n", "utf8");
}
