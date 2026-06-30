/**
 * In-memory conversation store.
 * Keyed by `${business_connection_id}:${chat_id}`.
 * Roles use Gemini's convention: "user" (incoming) and "model" (our reply).
 */

export type Role = "user" | "model";

export interface Message {
  role: Role;
  content: string;
}

// 20 message *pairs* -> 40 entries.
const MAX_MESSAGES = 40;

const store = new Map<string, Message[]>();

export function sessionKey(businessConnectionId: string, chatId: number): string {
  return `${businessConnectionId}:${chatId}`;
}

export function getHistory(key: string): Message[] {
  return store.get(key) ?? [];
}

export function addMessage(key: string, role: Role, content: string): void {
  const history = store.get(key) ?? [];
  history.push({ role, content });
  if (history.length > MAX_MESSAGES) {
    history.splice(0, history.length - MAX_MESSAGES);
  }
  store.set(key, history);
}

export function clearHistory(key: string): void {
  store.delete(key);
}

/** Drop every chat tied to a business connection (e.g. on disconnect). */
export function clearByConnection(businessConnectionId: string): void {
  const prefix = `${businessConnectionId}:`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
