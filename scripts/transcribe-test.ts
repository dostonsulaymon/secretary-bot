/**
 * Manually verify Gemini voice transcription with a local audio file.
 * Usage: npx ts-node scripts/transcribe-test.ts <path-to-audio> [mimeType]
 * Example: npx ts-node scripts/transcribe-test.ts ./voice.ogg audio/ogg
 *
 * Save a Telegram voice note (…/Downloads/*.ogg) and point this at it to
 * confirm Uzbek/Russian transcription quality before trusting it live.
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { transcribeAudio } from "../src/ai/gemini";

async function main() {
  const path = process.argv[2];
  const mimeType = process.argv[3] ?? "audio/ogg";
  if (!path) {
    console.error("Usage: npx ts-node scripts/transcribe-test.ts <path-to-audio> [mimeType]");
    process.exit(1);
  }
  const base64 = readFileSync(path).toString("base64");
  console.log(`Transcribing ${path} (${mimeType})…\n`);
  const text = await transcribeAudio(base64, mimeType);
  console.log("Transcription:\n" + (text || "(no speech detected)"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
