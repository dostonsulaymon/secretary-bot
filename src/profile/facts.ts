import { readFileSync } from "fs";
import { join } from "path";

/**
 * Personal knowledge base: facts the bot may rely on, plus canned guidance for
 * common questions. Lets it actually answer instead of deflecting everything.
 * Loaded once at startup from facts.json (falls back to facts.example.json).
 */

interface FaqEntry {
  q: string;
  a: string;
}

interface FactsFile {
  facts?: string[];
  faq?: FaqEntry[];
}

function loadFactsFile(): FactsFile {
  for (const name of ["facts.json", "facts.example.json"]) {
    try {
      const raw = readFileSync(join(process.cwd(), name), "utf8");
      return JSON.parse(raw) as FactsFile;
    } catch {
      // not found / unreadable — try the next candidate
    }
  }
  console.warn("No facts.json or facts.example.json found — the bot will deflect factual questions.");
  return {};
}

const file = loadFactsFile();

/** Compose the knowledge-base section of the system prompt (built once). */
export function buildFactsContext(): string {
  const sections: string[] = [];

  if (file.facts?.length) {
    sections.push(
      "Facts about you — you may use these to answer, but never state anything beyond them as fact:\n" +
        file.facts.map((f) => `- ${f}`).join("\n"),
    );
  }

  if (file.faq?.length) {
    sections.push(
      "Guidance for common questions:\n" +
        file.faq.map((e) => `- If asked "${e.q}" → ${e.a}`).join("\n"),
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
