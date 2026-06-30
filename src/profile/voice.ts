import { readFileSync } from "fs";
import { join } from "path";

/**
 * Voice profile = few-shot examples + light style hints that teach Gemini
 * how the owner actually writes. Loaded once at startup from voice.json
 * (falls back to the committed voice.example.json template).
 */

interface VoiceExample {
  incoming: string;
  reply: string;
}

interface VoiceStyle {
  length?: string;
  emoji?: string;
  capitalization?: string;
  languages?: string[];
}

interface VoiceProfile {
  style?: VoiceStyle;
  examples?: VoiceExample[];
}

function loadVoiceProfile(): VoiceProfile {
  for (const name of ["voice.json", "voice.example.json"]) {
    try {
      const raw = readFileSync(join(process.cwd(), name), "utf8");
      return JSON.parse(raw) as VoiceProfile;
    } catch {
      // not found / unreadable — try the next candidate
    }
  }
  console.warn("No voice.json or voice.example.json found — using base system prompt only.");
  return {};
}

const profile = loadVoiceProfile();

function renderStyle(style: VoiceStyle): string | null {
  const lines: string[] = [];
  if (style.length) lines.push(`- Length: ${style.length}`);
  if (style.emoji) lines.push(`- Emoji: ${style.emoji}`);
  if (style.capitalization) lines.push(`- Capitalization: ${style.capitalization}`);
  if (style.languages?.length) {
    lines.push(`- Reply in the sender's language (you know: ${style.languages.join(", ")}).`);
  }
  return lines.length ? `How you write:\n${lines.join("\n")}` : null;
}

function renderExamples(examples: VoiceExample[]): string {
  const rendered = examples
    .map((ex, i) => `Example ${i + 1}:\nThem: ${ex.incoming}\nYou: ${ex.reply}`)
    .join("\n\n");
  return (
    "Below are real examples of how you actually reply. Mirror this voice — the wording, " +
    "length, punctuation, capitalization, and tone. Do NOT copy them verbatim or reuse their " +
    "content; only match the style.\n\n" +
    rendered
  );
}

/**
 * Compose the final system instruction: base persona + style hints + voice examples.
 * Built once and reused; editing voice.json requires a restart.
 */
export function buildSystemPrompt(basePrompt: string): string {
  const sections: string[] = [basePrompt.trim()];

  if (profile.style) {
    const styleBlock = renderStyle(profile.style);
    if (styleBlock) sections.push(styleBlock);
  }

  if (profile.examples?.length) {
    sections.push(renderExamples(profile.examples));
  }

  sections.push(
    "Output ONLY the message you would send — no preamble, no explanations, no reasoning, " +
      "and never a label like 'THOUGHT:' or 'Answer:'. Just the message text, exactly as you'd type it.",
  );

  return sections.join("\n\n");
}
