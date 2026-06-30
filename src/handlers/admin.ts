import { Context } from "grammy";
import { generateJson } from "../ai/gemini";
import {
  upsertContact,
  deleteContact,
  getContactByTarget,
  listContacts,
  normalizeTarget,
  type Contact,
} from "../profile/contacts";

/**
 * Owner control panel. When the owner DMs the bot, their message is parsed
 * (via Gemini) into a contact-book command. "set" is confirmed before saving;
 * get/list/delete act immediately.
 */

interface ParsedCommand {
  action: "set" | "get" | "delete" | "list" | "unknown";
  target: string | null;
  name?: string | null;
  relationship?: string | null;
  gender?: "male" | "female" | null;
  tone?: string | null;
  notes?: string | null;
}

interface Pending {
  target: string;
  patch: Contact;
}

// One pending "save this?" confirmation per owner at a time.
const pending = new Map<number, Pending>();

const PARSER_PROMPT = `You parse the bot owner's instruction for managing their personal contact book.
Return ONLY a JSON object: { "action", "target", "name", "relationship", "gender", "tone", "notes" }.

- action: "set" to add/update a contact, "get" to show one, "delete" to remove one, "list" to show all, "unknown" if unclear.
- target: the person's @username or numeric id if given; if only a name is given, use the name; else null.
- name: a human name for the contact (infer from the @username if no explicit name, e.g. "@ali_k" -> "Ali").
- relationship: e.g. "client", "family", "friend", "colleague".
- gender: "male", "female", or null.
- tone: how to speak to them, e.g. "formal, professional" or "warm and casual".
- notes: any rules or context, e.g. "never quote a price".
- Any field not mentioned: null.

Examples:
"treat @ali as my client, keep it formal, he's a he, never quote prices" -> {"action":"set","target":"@ali","name":"Ali","relationship":"client","gender":"male","tone":"formal, professional","notes":"never quote a price"}
"my sister @dilnoza, be warm with her" -> {"action":"set","target":"@dilnoza","name":"Dilnoza","relationship":"family (sister)","gender":"female","tone":"warm and affectionate","notes":null}
"who is @ali" -> {"action":"get","target":"@ali","name":null,"relationship":null,"gender":null,"tone":null,"notes":null}
"forget 123456789" -> {"action":"delete","target":"123456789","name":null,"relationship":null,"gender":null,"tone":null,"notes":null}
"list my contacts" -> {"action":"list","target":null,"name":null,"relationship":null,"gender":null,"tone":null,"notes":null}`;

function isAffirmative(t: string): boolean {
  return /^(y|yes|yeah|yep|yup|sure|ok|okay|save|do it|confirm|ha|ha'?a|да|давай)\b/i.test(t.trim());
}
function isNegative(t: string): boolean {
  return /^(n|no|nope|cancel|stop|don'?t|nah|bekor|yo'?q|нет|отмена)\b/i.test(t.trim());
}

function cardText(key: string, c: Contact): string {
  const lines = [`${key}`, `  Name: ${c.name ?? "—"}`, `  Relationship: ${c.relationship ?? "—"}`];
  if (c.gender) lines.push(`  Gender: ${c.gender}`);
  if (c.tone) lines.push(`  Tone: ${c.tone}`);
  if (c.notes) lines.push(`  Notes: ${c.notes}`);
  return lines.join("\n");
}

function parseJsonLoose(raw: string): ParsedCommand {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(cleaned) as ParsedCommand;
}

export async function handleOwnerMessage(ctx: Context, ownerId: number, text: string): Promise<void> {
  // Resolve a pending "save this?" first.
  const p = pending.get(ownerId);
  if (p) {
    if (isAffirmative(text)) {
      const res = upsertContact(p.target, p.patch);
      pending.delete(ownerId);
      await ctx.reply(res ? `✅ Saved ${res.key}.` : "⚠️ Couldn't save — I need a valid @username or numeric id.");
      return;
    }
    if (isNegative(text)) {
      pending.delete(ownerId);
      await ctx.reply("Okay, discarded.");
      return;
    }
    // Anything else: treat it as a brand-new instruction.
    pending.delete(ownerId);
  }

  let cmd: ParsedCommand;
  try {
    cmd = parseJsonLoose(await generateJson(PARSER_PROMPT, text));
  } catch {
    await ctx.reply('Couldn\'t parse that. Try: "treat @ali as my client, formal, he\'s a he".');
    return;
  }

  switch (cmd.action) {
    case "list": {
      const all = listContacts();
      if (!all.length) {
        await ctx.reply("No saved contacts yet.");
        return;
      }
      const lines = all.map(
        ({ key, contact }) => `• ${key} — ${contact.relationship ?? "?"}${contact.name ? ` (${contact.name})` : ""}`,
      );
      await ctx.reply("Your contacts:\n" + lines.join("\n"));
      return;
    }

    case "get": {
      if (!cmd.target) {
        await ctx.reply("Who do you mean? Give me their @username or numeric id.");
        return;
      }
      const c = getContactByTarget(cmd.target);
      const key = normalizeTarget(cmd.target) ?? cmd.target;
      await ctx.reply(c ? cardText(key, c) : `I don't have ${cmd.target} saved.`);
      return;
    }

    case "delete": {
      if (!cmd.target) {
        await ctx.reply("Who should I forget? Give me their @username or numeric id.");
        return;
      }
      const ok = deleteContact(cmd.target);
      await ctx.reply(ok ? `🗑️ Forgot ${normalizeTarget(cmd.target)}.` : `I don't have ${cmd.target} saved.`);
      return;
    }

    case "set": {
      const key = cmd.target ? normalizeTarget(cmd.target) : null;
      if (!key) {
        await ctx.reply(
          "I need a @username or numeric chat_id to tag them. What's theirs? " +
            "(When someone messages you, I log their id — check the bot logs.)",
        );
        return;
      }
      const patch: Contact = stripNulls({
        name: cmd.name,
        relationship: cmd.relationship,
        gender: cmd.gender,
        tone: cmd.tone,
        notes: cmd.notes,
      });
      const preview: Contact = { ...getContactByTarget(cmd.target!), ...patch };
      pending.set(ownerId, { target: cmd.target!, patch });
      await ctx.reply(`Got it — save this?\n\n${cardText(key, preview)}\n\nReply "yes" to save, or tell me what to change.`);
      return;
    }

    default:
      await ctx.reply(
        'I manage your contacts. Try:\n' +
          '• "treat @ali as my client, formal, he\'s a he"\n' +
          '• "who is @ali"\n' +
          '• "list my contacts"\n' +
          '• "forget @ali"',
      );
  }
}

function stripNulls(obj: Record<string, unknown>): Contact {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  ) as Contact;
}
