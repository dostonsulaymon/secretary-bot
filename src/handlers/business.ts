import { Bot, GrammyError, type Context } from "grammy";
import { generateReply } from "../ai/gemini";
import { buildSystemPrompt } from "../profile/voice";
import { getContactContext } from "../profile/contacts";
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

    let reply: string;
    try {
      const systemPrompt = [
        COMPOSED_SYSTEM_PROMPT,
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

    try {
      await ctx.api.sendMessage(chatId, reply, {
        business_connection_id: bizConnId,
      });
      // Only persist once the send succeeds, so history stays consistent.
      addMessage(key, "user", text);
      addMessage(key, "model", reply);
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
