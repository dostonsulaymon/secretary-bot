import { Bot, GrammyError, type Context } from "grammy";
import { generateReply } from "../ai/gemini";
import { buildSystemPrompt } from "../profile/voice";
import { getContactContext } from "../profile/contacts";
import { buildFactsContext } from "../profile/facts";
import {
  sessionKey,
  getHistory,
  addMessage,
  clearByConnection,
} from "../store/sessions";

const OWNER_USER_ID = Number(process.env.OWNER_USER_ID);
const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ??
  "You are a helpful personal assistant replying on behalf of the account owner.";

// Base persona + voice examples + style hints, composed once at startup.
// (Facts are composed per message via buildFactsContext() so chat edits apply live.)
const COMPOSED_SYSTEM_PROMPT = buildSystemPrompt(SYSTEM_PROMPT);

// Owner's timezone — used to ground "what time/day is it" questions. Change as needed.
const OWNER_TIMEZONE = process.env.OWNER_TIMEZONE ?? "Asia/Tashkent";

/** Fresh real-world context injected per message so replies aren't time-blind. */
function ownerContext(): string {
  const now = new Intl.DateTimeFormat("en-GB", {
    timeZone: OWNER_TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return `Current date and time (${OWNER_TIMEZONE}): ${now}. Use this if asked about the time or date — do not guess.`;
}

// Natural reply pacing. Real humans are bursty: usually quick (at the phone), but
// occasionally away for minutes. We model a mostly-quick-but-sometimes-long *silent*
// gap, then a short "typing…" burst right before sending.
const NATURAL_TYPING = (process.env.NATURAL_TYPING ?? "true").toLowerCase() !== "false";

const PRESENT_GAP_MS: readonly [number, number] = [1000, 12000]; // "at my phone"
const AWAY_GAP_MS: readonly [number, number] = [30000, 120000]; // "stepped away"
const ACTIVE_WINDOW_MS = 60000; // replied recently => still in the conversation
const AWAY_CHANCE_ACTIVE = 0.08; // small chance of a gap mid-conversation
const AWAY_CHANCE_IDLE = 0.3; // larger chance when the chat has been quiet

// Per-chat timestamp of our last reply, for conversation-momentum bias.
const lastReplyAt = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randRange([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}

/** Pick the silent "before I start typing" gap: usually short, sometimes (away) long. */
function decideGapMs(key: string): number {
  const sinceLast = Date.now() - (lastReplyAt.get(key) ?? 0);
  const awayChance = sinceLast < ACTIVE_WINDOW_MS ? AWAY_CHANCE_ACTIVE : AWAY_CHANCE_IDLE;
  return randRange(Math.random() < awayChance ? AWAY_GAP_MS : PRESENT_GAP_MS);
}

/** How long the actual "typing…" burst lasts — proportional to reply length. */
function typingMs(reply: string): number {
  return Math.min(Math.max(reply.length * 45, 1500), 8000);
}

/** Keep the "typing…" indicator alive for `ms` (Telegram clears it after ~5s). */
async function showTyping(ctx: Context, chatId: number, bizConnId: string, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      await ctx.api.sendChatAction(chatId, "typing", { business_connection_id: bizConnId });
    } catch {
      // best-effort — never let a typing blip stop the actual reply
    }
    await sleep(Math.min(4000, end - Date.now()));
  }
}

/** What we remember about an active business connection. */
interface ConnectionInfo {
  id: string;
  userChatId: number;
  canReply: boolean;
  isEnabled: boolean;
}

const connections = new Map<string, ConnectionInfo>();

/**
 * Bot API 9.0 moved `can_reply` from the connection root into `rights`.
 * Read both so we survive either Bot API / @grammyjs/types version.
 */
function extractCanReply(conn: unknown): boolean {
  const c = conn as { rights?: { can_reply?: boolean }; can_reply?: boolean };
  return c.rights?.can_reply ?? c.can_reply ?? false;
}

function isInactiveChatError(err: unknown): boolean {
  return (
    err instanceof GrammyError &&
    err.description.includes("BUSINESS_CHAT_INACTIVE")
  );
}

async function notifyOwner(ctx: Context, text: string): Promise<void> {
  if (!Number.isFinite(OWNER_USER_ID)) return;
  try {
    await ctx.api.sendMessage(OWNER_USER_ID, text);
  } catch (err) {
    console.error("Failed to notify owner:", err);
  }
}

export function registerBusinessHandlers(bot: Bot): void {
  // 1. Connection lifecycle: connect / disconnect.
  bot.on("business_connection", async (ctx) => {
    const conn = ctx.businessConnection;
    const canReply = extractCanReply(conn);

    if (!conn.is_enabled) {
      connections.delete(conn.id);
      clearByConnection(conn.id);
      console.log(`Business connection disabled: ${conn.id}`);
      await notifyOwner(ctx, `🔌 Secretary Mode disconnected (connection ${conn.id}).`);
      return;
    }

    connections.set(conn.id, {
      id: conn.id,
      userChatId: conn.user_chat_id,
      canReply,
      isEnabled: conn.is_enabled,
    });

    console.log(
      `Business connection active: ${conn.id} (user_chat_id=${conn.user_chat_id}, can_reply=${canReply})`,
    );
    await notifyOwner(
      ctx,
      `✅ Secretary Mode active.\nConnection ID: ${conn.id}\ncan_reply: ${canReply}`,
    );

    if (!canReply) {
      await notifyOwner(
        ctx,
        "⚠️ This connection does NOT grant reply permission. Enable 'Reply to messages' in Telegram → Chat Automation so I can respond.",
      );
    }
  });

  // 2. Incoming message in a managed chat — the core auto-responder.
  bot.on("business_message", async (ctx) => {
    const msg = ctx.update.business_message;
    if (!msg) return;

    const bizConnId = msg.business_connection_id;
    const chatId = msg.chat.id;
    const text = msg.text;
    const fromId = msg.from?.id;

    if (!bizConnId) return;

    // Log sender identity so the owner can reference them in contacts (chat_id / @username).
    console.log(
      `business_message from id=${fromId}${msg.from?.username ? ` @${msg.from.username}` : ""} in chat ${chatId}`,
    );

    // Only handle plain text for now.
    if (!text) return;

    // Never reply to the owner's own outgoing messages.
    if (fromId !== undefined && fromId === OWNER_USER_ID) return;

    // Respect reply rights if we know them for this connection.
    const conn = connections.get(bizConnId);
    if (conn && !conn.canReply) {
      console.warn(`Connection ${bizConnId} lacks can_reply; skipping chat ${chatId}.`);
      return;
    }

    const key = sessionKey(bizConnId, chatId);
    const history = getHistory(key);

    const startedAt = Date.now();
    let reply: string;
    try {
      const systemPrompt = [
        COMPOSED_SYSTEM_PROMPT,
        buildFactsContext(),
        ownerContext(),
        getContactContext(chatId, msg.from?.username),
      ]
        .filter(Boolean)
        .join("\n\n");
      reply = await generateReply(systemPrompt, history, text);
    } catch (err) {
      console.error(`Gemini error for chat ${chatId}:`, err);
      await notifyOwner(
        ctx,
        `⚠️ Gemini failed to answer chat ${chatId}: ${(err as Error).message}`,
      );
      // Do NOT send a broken/placeholder reply — stay silent.
      return;
    }

    // Human pacing: a mostly-quick but sometimes long *silent* gap (you're "away" —
    // no typing shown), then a short typing burst right before sending. Gemini's own
    // latency counts toward the gap.
    if (NATURAL_TYPING) {
      const gap = decideGapMs(key) - (Date.now() - startedAt);
      if (gap > 0) await sleep(gap);
      await showTyping(ctx, chatId, bizConnId, typingMs(reply));
    }

    try {
      await ctx.api.sendMessage(chatId, reply, {
        business_connection_id: bizConnId,
      });
      // Only persist once the send succeeds, so history stays consistent.
      addMessage(key, "user", text);
      addMessage(key, "model", reply);
      lastReplyAt.set(key, Date.now()); // for conversation-momentum pacing

    } catch (err) {
      if (isInactiveChatError(err)) {
        console.warn(`Chat ${chatId} outside 24h activity window — skipping silently.`);
        return;
      }
      console.error(`Failed to send business reply to chat ${chatId}:`, err);
      await notifyOwner(
        ctx,
        `⚠️ Couldn't send reply to chat ${chatId}: ${(err as Error).message}`,
      );
    }
  });

  // 3. Cleanup when managed messages are deleted (best-effort, log only).
  bot.on("deleted_business_messages", (ctx) => {
    const del = ctx.update.deleted_business_messages;
    console.log(
      `Messages deleted in chat ${del.chat.id} (connection ${del.business_connection_id}).`,
    );
  });
}
