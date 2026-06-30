import { GoogleGenerativeAI, type Content } from "@google/generative-ai";
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

  const result = await model.generateContent({ contents });
  const text = result.response.text().trim();

  if (!text) {
    throw new Error("Gemini returned an empty response");
  }
  return text;
}
