import { Context } from "grammy";
import { generateJson } from "../ai/gemini";
import {
  upsertContact,
  deleteContact,
  clearContacts,
  addContactExamples,
  getContactByTarget,
  listContacts,
  normalizeTarget,
  MAX_CONTACT_EXAMPLES,
  type Contact,
  type ContactExample,
} from "../profile/contacts";
import {
  addFact,
  addFaq,
  removeKnowledge,
  clearKnowledge,
  listFacts,
  listFaq,
} from "../profile/facts";

/**
 * Owner control panel. When the owner DMs the bot, their message is parsed
 * (via Gemini) into a command over two domains:
 *   - "contact"   → manage who the bot is talking to (tone, gender, rules)
 *   - "knowledge" → manage facts/FAQ the bot may answer from
 * Additive commands (set/add) are confirmed before saving; get/list/delete act immediately.
 */

interface ParsedCommand {
  domain: "contact" | "knowledge" | "all" | "unknown";
  action: "set" | "add" | "get" | "delete" | "list" | "clear" | "unknown";
  // contact
  target?: string | null;
  name?: string | null;
  relationship?: string | null;
  gender?: "male" | "female" | null;
  tone?: string | null;
  notes?: string | null;
  // knowledge
  fact?: string | null;
  faqQuestion?: string | null;
  faqAnswer?: string | null;
  match?: string | null;
}

// One pending "save this?" confirmation per owner. commit() runs on "yes" and returns the reply.
interface Pending {
  commit: () => string;
}
const pending = new Map<number, Pending>();

const PARSER_PROMPT = `You parse the bot owner's instruction for managing their personal secretary bot.
Return ONLY a JSON object with keys:
{ "domain", "action", "target", "name", "relationship", "gender", "tone", "notes", "fact", "faqQuestion", "faqAnswer", "match" }

- domain: "contact" (managing a person) | "knowledge" (managing facts/FAQ about the owner) | "all" (both, for a full reset) | "unknown".
- action: "set"/"add" to create or update, "get" to show one, "delete" to remove one, "list" to show all, "clear" to wipe everything in that domain, "unknown" if unclear.

CONTACT fields (domain "contact"):
- target: the person's @username or numeric id; if only a name is given, use the name; else null.
- name: a human name (infer from @username if needed, e.g. "@ali_k" -> "Ali").
- relationship, tone, notes: as described. gender: "male"/"female"/null. Unmentioned fields: null.

KNOWLEDGE fields (domain "knowledge"):
- fact: a standalone fact about the owner, phrased in third person (e.g. "Doston doesn't work weekends"). Null if not adding a plain fact.
- faqQuestion + faqAnswer: when the owner says how to answer a specific question. Null otherwise.
- match: text to find when deleting a fact/FAQ (e.g. delete "the fact about weekends" -> match "weekend").

Examples:
"treat @ali as my client, formal, he's a he, never quote prices" -> {"domain":"contact","action":"set","target":"@ali","name":"Ali","relationship":"client","gender":"male","tone":"formal, professional","notes":"never quote a price","fact":null,"faqQuestion":null,"faqAnswer":null,"match":null}
"who is @ali" -> {"domain":"contact","action":"get","target":"@ali","name":null,"relationship":null,"gender":null,"tone":null,"notes":null,"fact":null,"faqQuestion":null,"faqAnswer":null,"match":null}
"list my contacts" -> {"domain":"contact","action":"list","target":null,"name":null,"relationship":null,"gender":null,"tone":null,"notes":null,"fact":null,"faqQuestion":null,"faqAnswer":null,"match":null}
"add a fact: I don't work weekends" -> {"domain":"knowledge","action":"add","target":null,"name":null,"relationship":null,"gender":null,"tone":null,"notes":null,"fact":"Doston doesn't work weekends","faqQuestion":null,"faqAnswer":null,"match":null}
"when someone asks for my email, tell them to message me here" -> {"domain":"knowledge","action":"add","target":null,"name":null,"relationship":null,"gender":null,"tone":null,"notes":null,"fact":null,"faqQuestion":"what's your email?","faqAnswer":"Tell them to message you here on Telegram.","match":null}
"forget the fact about weekends" -> {"domain":"knowledge","action":"delete","target":null,"name":null,"relationship":null,"gender":null,"tone":null,"notes":null,"fact":null,"faqQuestion":null,"faqAnswer":null,"match":"weekend"}
"what do you know about me" -> {"domain":"knowledge","action":"list","target":null,"name":null,"relationship":null,"gender":null,"tone":null,"notes":null,"fact":null,"faqQuestion":null,"faqAnswer":null,"match":null}
"clear all my facts" -> {"domain":"knowledge","action":"clear","target":null,"name":null,"relationship":null,"gender":null,"tone":null,"notes":null,"fact":null,"faqQuestion":null,"faqAnswer":null,"match":null}
"clear all my contacts" -> {"domain":"contact","action":"clear","target":null,"name":null,"relationship":null,"gender":null,"tone":null,"notes":null,"fact":null,"faqQuestion":null,"faqAnswer":null,"match":null}
"reset everything" -> {"domain":"all","action":"clear","target":null,"name":null,"relationship":null,"gender":null,"tone":null,"notes":null,"fact":null,"faqQuestion":null,"faqAnswer":null,"match":null}`;

const LEARN_PROMPT = `You are given a real Telegram conversation that the bot owner pasted, plus the contact's @handle.
Infer how the OWNER talks to THIS specific person, so the bot can mimic that relationship.

In the transcript, the participant whose display name matches the contact handle is "them"; the OTHER participant is the owner ("me").
Return ONLY JSON:
{
  "relationship": "short phrase, e.g. close friend / younger brother / client" or null,
  "tone": "short phrase describing how the owner talks to them, e.g. casual, warm, joking, informal Uzbek, uses emojis" or null,
  "examples": [ { "them": "<their message>", "me": "<owner's reply, verbatim>" }, ... up to ${MAX_CONTACT_EXAMPLES} representative pairs ]
}
Use the owner's ACTUAL words for "me", verbatim. Pick the pairs that best capture the dynamic and voice. If you can't tell, use null / [].`;

interface LearnResult {
  relationship?: string | null;
  tone?: string | null;
  examples?: unknown;
}

function looksLikeTranscript(text: string): boolean {
  const lines = text.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 4) return false;
  const speakerish = lines.filter((l) => /\S:\s/.test(l)).length;
  return speakerish >= Math.ceil(lines.length * 0.6);
}

function extractAtUsername(text: string): string | null {
  const m = text.match(/@[A-Za-z][A-Za-z0-9_]{2,}/);
  return m ? m[0] : null;
}

function isAffirmative(t: string): boolean {
  return /^(y|yes|yeah|yep|yup|sure|ok|okay|save|do it|confirm|ha|ha'?a|да|давай)\b/i.test(t.trim());
}
function isNegative(t: string): boolean {
  return /^(n|no|nope|cancel|stop|don'?t|nah|bekor|yo'?q|нет|отмена)\b/i.test(t.trim());
}

function contactCard(key: string, c: Contact): string {
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

function stripNulls(obj: Record<string, unknown>): Contact {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  ) as Contact;
}

export async function handleOwnerMessage(ctx: Context, ownerId: number, text: string): Promise<void> {
  // Slash commands are handled directly — no need to spend a Gemini call parsing them.
  if (/^\/(start|help|commands)\b/i.test(text.trim())) {
    pending.delete(ownerId);
    await ctx.reply(helpText());
    return;
  }

  // Resolve a pending "save this?" first.
  const p = pending.get(ownerId);
  if (p) {
    if (isAffirmative(text)) {
      pending.delete(ownerId);
      await ctx.reply(p.commit());
      return;
    }
    if (isNegative(text)) {
      pending.delete(ownerId);
      await ctx.reply("Okay, discarded.");
      return;
    }
    pending.delete(ownerId); // anything else: treat as a new instruction
  }

  // A pasted conversation → learn the relationship from it.
  if (looksLikeTranscript(text)) {
    await handleLearn(ctx, ownerId, text);
    return;
  }

  let cmd: ParsedCommand;
  try {
    cmd = parseJsonLoose(await generateJson(PARSER_PROMPT, text));
  } catch {
    await ctx.reply('Couldn\'t parse that. Try: "treat @ali as my client" or "add a fact: I don\'t work weekends".');
    return;
  }

  if (cmd.action === "clear") {
    await handleClear(ctx, ownerId, cmd.domain);
    return;
  }
  if (cmd.domain === "knowledge") {
    await handleKnowledge(ctx, ownerId, cmd);
    return;
  }
  if (cmd.domain === "contact") {
    await handleContact(ctx, ownerId, cmd);
    return;
  }
  await ctx.reply(helpText());
}

async function handleLearn(ctx: Context, ownerId: number, text: string): Promise<void> {
  const target = extractAtUsername(text);
  if (!target) {
    await ctx.reply(
      'Whose chat is this? Include their @username, e.g. "this is my chat with @bekzod:" then paste the conversation.',
    );
    return;
  }

  let parsed: LearnResult;
  try {
    const raw = await generateJson(LEARN_PROMPT, `Contact: ${target}\n\nTranscript:\n${text}`);
    parsed = JSON.parse(raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()) as LearnResult;
  } catch {
    await ctx.reply("I couldn't read that conversation. Make sure it's a normal pasted chat.");
    return;
  }

  const examples: ContactExample[] = Array.isArray(parsed.examples)
    ? parsed.examples
        .filter((e): e is ContactExample => {
          const x = e as Partial<ContactExample>;
          return !!x && typeof x.them === "string" && typeof x.me === "string" && x.them !== "" && x.me !== "";
        })
        .slice(0, MAX_CONTACT_EXAMPLES)
    : [];

  const rel = parsed.relationship ?? null;
  const tone = parsed.tone ?? null;

  if (!examples.length && !rel && !tone) {
    await ctx.reply("I couldn't pull much from that — try pasting more of the conversation.");
    return;
  }

  pending.set(ownerId, {
    commit: () => {
      if (rel || tone) upsertContact(target, stripNulls({ relationship: rel, tone }));
      const res = addContactExamples(target, examples);
      return res
        ? `✅ Learned ${res.count} example(s) for ${res.key}.`
        : "⚠️ Couldn't save — I need a valid @username.";
    },
  });

  const lines = [
    `From your chat with ${target}, here's what I picked up:`,
    rel ? `• Relationship: ${rel}` : null,
    tone ? `• Tone: ${tone}` : null,
    `• ${examples.length} example exchange(s)`,
    "",
    'Save this to their profile? Reply "yes".',
  ].filter(Boolean);
  await ctx.reply(lines.join("\n"));
}

async function handleClear(ctx: Context, ownerId: number, domain: ParsedCommand["domain"]): Promise<void> {
  const knowledgeN = listFacts().length + listFaq().length;
  const contactsN = listContacts().length;

  if (domain === "knowledge") {
    if (!knowledgeN) {
      await ctx.reply("No facts or FAQ to clear.");
      return;
    }
    pending.set(ownerId, {
      commit: () => {
        const c = clearKnowledge();
        return `🗑️ Cleared ${c.facts} fact(s) and ${c.faq} FAQ.`;
      },
    });
    await ctx.reply(`⚠️ This permanently deletes all ${knowledgeN} fact(s)/FAQ. Reply "yes" to confirm.`);
    return;
  }

  if (domain === "contact") {
    if (!contactsN) {
      await ctx.reply("No contacts to clear.");
      return;
    }
    pending.set(ownerId, { commit: () => `🗑️ Cleared ${clearContacts()} contact(s).` });
    await ctx.reply(`⚠️ This permanently deletes all ${contactsN} contact(s). Reply "yes" to confirm.`);
    return;
  }

  if (domain === "all") {
    if (!knowledgeN && !contactsN) {
      await ctx.reply("Nothing to clear.");
      return;
    }
    pending.set(ownerId, {
      commit: () => {
        const c = clearKnowledge();
        const n = clearContacts();
        return `🗑️ Cleared ${n} contact(s), ${c.facts} fact(s), and ${c.faq} FAQ.`;
      },
    });
    await ctx.reply(
      `⚠️ This permanently deletes ALL ${contactsN} contact(s) and ${knowledgeN} fact(s)/FAQ. Reply "yes" to confirm.`,
    );
    return;
  }

  await ctx.reply('Clear what? Try "clear all facts", "clear all contacts", or "reset everything".');
}

async function handleKnowledge(ctx: Context, ownerId: number, cmd: ParsedCommand): Promise<void> {
  switch (cmd.action) {
    case "list": {
      const facts = listFacts();
      const faq = listFaq();
      if (!facts.length && !faq.length) {
        await ctx.reply("I don't have any facts saved about you yet.");
        return;
      }
      const parts: string[] = [];
      if (facts.length) parts.push("Facts:\n" + facts.map((f) => `• ${f}`).join("\n"));
      if (faq.length) parts.push("FAQ:\n" + faq.map((e) => `• ${e.q} → ${e.a}`).join("\n"));
      await ctx.reply(parts.join("\n\n"));
      return;
    }

    case "delete": {
      if (!cmd.match) {
        await ctx.reply("What should I forget? e.g. \"forget the fact about weekends\".");
        return;
      }
      const removed = removeKnowledge(cmd.match);
      await ctx.reply(
        removed.length
          ? `🗑️ Removed:\n${removed.map((r) => `• ${r}`).join("\n")}`
          : `Nothing matched "${cmd.match}".`,
      );
      return;
    }

    case "add":
    case "set": {
      if (cmd.faqQuestion && cmd.faqAnswer) {
        const q = cmd.faqQuestion;
        const a = cmd.faqAnswer;
        pending.set(ownerId, {
          commit: () => {
            addFaq(q, a);
            return "✅ Saved that guidance.";
          },
        });
        await ctx.reply(`Add this Q&A?\n\nIf asked: "${q}"\nYou'll say: ${a}\n\nReply "yes" to save.`);
        return;
      }
      if (cmd.fact) {
        const fact = cmd.fact;
        pending.set(ownerId, {
          commit: () => {
            addFact(fact);
            return "✅ Added that fact.";
          },
        });
        await ctx.reply(`Add this fact?\n\n"${fact}"\n\nReply "yes" to save.`);
        return;
      }
      await ctx.reply('What should I remember? e.g. "add a fact: I\'m based in Tashkent".');
      return;
    }

    default:
      await ctx.reply(helpText());
  }
}

async function handleContact(ctx: Context, ownerId: number, cmd: ParsedCommand): Promise<void> {
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
      await ctx.reply(c ? contactCard(key, c) : `I don't have ${cmd.target} saved.`);
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

    case "add":
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
      const target = cmd.target!;
      const preview: Contact = { ...getContactByTarget(target), ...patch };
      pending.set(ownerId, {
        commit: () => {
          const res = upsertContact(target, patch);
          return res ? `✅ Saved ${res.key}.` : "⚠️ Couldn't save — I need a valid @username or numeric id.";
        },
      });
      await ctx.reply(`Got it — save this?\n\n${contactCard(key, preview)}\n\nReply "yes" to save, or tell me what to change.`);
      return;
    }

    default:
      await ctx.reply(helpText());
  }
}

function helpText(): string {
  return [
    "I'm Donna — I manage your contacts and the facts I know about you. Just tell me in plain words:",
    "",
    "👤 Contacts",
    '• Add / update — "treat @ali as my client, formal, he\'s a he"',
    '• Learn from a real chat — "this is my chat with @bekzod:" then paste the conversation',
    '• Remove — "forget @ali"',
    '• View — "who is @ali" · "list my contacts"',
    "",
    "📇 Facts about you",
    '• Add a fact — "add a fact: I don\'t work weekends"',
    '• Add a Q&A — "when someone asks for my email, tell them to message me here"',
    '• Remove — "forget the fact about weekends"',
    '• View — "what do you know about me"',
    "",
    "🧹 Clear (asks to confirm first)",
    '• "clear all facts" · "clear all contacts" · "reset everything"',
  ].join("\n");
}
