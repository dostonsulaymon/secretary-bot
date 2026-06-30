import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Per-contact awareness: who the bot is talking to, and how to behave with them.
 * Loaded at startup from contacts.json (falls back to contacts.example.json),
 * then held in memory as the source of truth. Mutations persist back to
 * contacts.json so the owner can edit contacts by DMing the bot — no restart.
 */

export interface Contact {
  name?: string;
  relationship?: string;
  gender?: "male" | "female";
  tone?: string;
  notes?: string;
}

interface ContactsFile {
  default?: { tone?: string };
  contacts?: Record<string, Contact>;
}

const CONTACTS_PATH = join(process.cwd(), "contacts.json");

function loadContactsFile(): ContactsFile {
  for (const name of ["contacts.json", "contacts.example.json"]) {
    try {
      const raw = readFileSync(join(process.cwd(), name), "utf8");
      return JSON.parse(raw) as ContactsFile;
    } catch {
      // not found / unreadable — try the next candidate
    }
  }
  console.warn("No contacts file found — starting with an empty contact book.");
  return {};
}

const file = loadContactsFile();
const defaults = file.default;
const contacts: Record<string, Contact> = file.contacts ?? {};

/** Normalize a reference into a storage key: "@username" (lowercased) or a numeric id string. */
export function normalizeTarget(target: string): string | null {
  const t = target.trim().replace(/^@/, "");
  if (/^\d{4,}$/.test(t)) return t; // numeric chat_id
  if (/^[A-Za-z][\w]{2,}$/.test(t)) return "@" + t.toLowerCase(); // username
  return null;
}

function renderContact(c: Contact): string {
  const who = c.name ?? "this person";
  const rel = c.relationship ? ` (${c.relationship})` : "";
  const parts = [`You are talking to ${who}${rel}.`];
  if (c.gender) parts.push(`Refer to them as ${c.gender === "male" ? "he/him" : "she/her"}.`);
  if (c.tone) parts.push(`Tone: ${c.tone}.`);
  if (c.notes) parts.push(`Notes: ${c.notes}.`);
  return parts.join(" ");
}

/**
 * Per-message contact context for the prompt: lookup by chat_id, then @username,
 * then the default. Returns "" if nothing applies.
 */
export function getContactContext(chatId: number, username?: string): string {
  const contact =
    contacts[String(chatId)] ??
    (username ? contacts["@" + username.toLowerCase()] : undefined);

  if (contact) return renderContact(contact);
  if (defaults?.tone) {
    return `You don't recognize this person — they're not in your saved contacts. ${defaults.tone}`;
  }
  return "";
}

// --- Owner-facing mutations (persist to disk) ---

export function getContactByTarget(target: string): Contact | undefined {
  const key = normalizeTarget(target);
  return key ? contacts[key] : undefined;
}

export function listContacts(): Array<{ key: string; contact: Contact }> {
  return Object.entries(contacts).map(([key, contact]) => ({ key, contact }));
}

/** Merge a patch into a contact (creating it if new) and persist. Returns null for an invalid target. */
export function upsertContact(target: string, patch: Contact): { key: string; contact: Contact } | null {
  const key = normalizeTarget(target);
  if (!key) return null;
  const merged: Contact = { ...(contacts[key] ?? {}), ...stripEmpty(patch) };
  contacts[key] = merged;
  persist();
  return { key, contact: merged };
}

export function deleteContact(target: string): boolean {
  const key = normalizeTarget(target);
  if (!key || !contacts[key]) return false;
  delete contacts[key];
  persist();
  return true;
}

/** Remove all saved contacts (keeps the default policy). Returns how many were removed. */
export function clearContacts(): number {
  const n = Object.keys(contacts).length;
  for (const key of Object.keys(contacts)) delete contacts[key];
  persist();
  return n;
}

function stripEmpty(obj: Contact): Contact {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  ) as Contact;
}

function persist(): void {
  const out: ContactsFile = { ...(defaults ? { default: defaults } : {}), contacts };
  writeFileSync(CONTACTS_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
}
