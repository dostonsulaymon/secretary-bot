import { readFileSync } from "fs";
import { join } from "path";

/**
 * Per-contact awareness: who is the bot talking to, and how should it behave
 * with them. Loaded once at startup from contacts.json (falls back to the
 * committed contacts.example.json template).
 */

interface Contact {
  name?: string;
  relationship?: string;
  tone?: string;
  notes?: string;
}

interface ContactsFile {
  default?: { tone?: string };
  contacts?: Record<string, Contact>;
}

function loadContactsFile(): ContactsFile {
  for (const name of ["contacts.json", "contacts.example.json"]) {
    try {
      const raw = readFileSync(join(process.cwd(), name), "utf8");
      return JSON.parse(raw) as ContactsFile;
    } catch {
      // not found / unreadable — try the next candidate
    }
  }
  console.warn("No contacts.json or contacts.example.json found — every sender gets the default treatment.");
  return {};
}

const file = loadContactsFile();

// Split the flat map into id-keyed and username-keyed lookups (usernames lowercased).
const byId = new Map<string, Contact>();
const byUsername = new Map<string, Contact>();
for (const [key, contact] of Object.entries(file.contacts ?? {})) {
  if (key.startsWith("@")) {
    byUsername.set(key.slice(1).toLowerCase(), contact);
  } else {
    byId.set(key, contact);
  }
}

function renderContact(c: Contact): string {
  const who = c.name ?? "this person";
  const rel = c.relationship ? ` (${c.relationship})` : "";
  const parts = [`You are talking to ${who}${rel}.`];
  if (c.tone) parts.push(`Tone: ${c.tone}.`);
  if (c.notes) parts.push(`Notes: ${c.notes}.`);
  return parts.join(" ");
}

/**
 * Resolve a per-message contact context line for the prompt.
 * Looks up by chat_id first, then @username, then falls back to the default.
 * Returns "" if nothing applies.
 */
export function getContactContext(chatId: number, username?: string): string {
  const contact =
    byId.get(String(chatId)) ??
    (username ? byUsername.get(username.replace(/^@/, "").toLowerCase()) : undefined);

  if (contact) return renderContact(contact);
  if (file.default?.tone) {
    return `You don't recognize this person — they're not in your saved contacts. ${file.default.tone}`;
  }
  return "";
}
