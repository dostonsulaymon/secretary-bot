import {
  GoogleGenerativeAI,
  type Content,
  type GenerationConfig,
} from "@google/generative-ai";
import type { Message } from "../store/sessions";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("GEMINI_API_KEY is not set in the environment");
}

const genAI = new GoogleGenerativeAI(apiKey);

const MODEL = "gemini-2.5-flash";

/**
 * Generate a reply with Gemini 2.5 Flash.
 *
 * @param systemPrompt persona / instructions
 * @param history      prior conversation (must alternate user/model, starting with user)
 * @param userMessage  the new incoming message
 * @returns Gemini's reply text
 * @throws if the API errors or returns an empty response — callers must catch.
 */
export async function generateReply(
  systemPrompt: string,
  history: Message[],
  userMessage: string,
): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: systemPrompt,
  });

  const contents: Content[] = history.map((m) => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));
  contents.push({ role: "user", parts: [{ text: userMessage }] });

  const result = await model.generateContent({
    contents,
    // Disable 2.5 Flash "thinking" so chain-of-thought can't leak into the reply.
    // thinkingConfig isn't in the 0.21 SDK types yet, but the REST API honors it.
    generationConfig: {
      temperature: 0.85,
      thinkingConfig: { thinkingBudget: 0 },
    } as unknown as GenerationConfig,
  });

  const text = sanitizeReply(result.response.text());

  if (!text) {
    throw new Error("Gemini returned an empty response");
  }
  return text;
}

/**
 * Defensive cleanup in case the model still emits a reasoning preamble.
 * Strips leading labels like "THOUGHT:", "REASONING:", "FINAL ANSWER:".
 */
function sanitizeReply(raw: string): string {
  let text = raw.trim();
  const labels = /^(thought|thinking|reasoning|analysis|final answer|answer|response)\s*:/i;
  // Drop leading labeled lines until we hit real content.
  const lines = text.split("\n");
  while (lines.length > 0 && labels.test(lines[0]!.trim())) {
    lines.shift();
  }
  text = lines.join("\n").trim();
  return text;
}
