import { Bot } from "grammy";
import { handleOwnerMessage } from "./admin";

const OWNER_USER_ID = Number(process.env.OWNER_USER_ID);

const DIRECT_REPLY =
  "This bot is Doston's personal secretary. You can reach him by messaging him directly.";

/**
 * Handles normal (non-business) messages sent directly to the bot.
 * - From the owner: treated as a contact-book command (see admin.ts).
 * - From anyone else: a canned reply.
 * Business messages arrive as `business_message` updates, so they never hit this.
 */
export function registerDirectHandlers(bot: Bot): void {
  bot.on("message", async (ctx) => {
    if (ctx.chat.type !== "private") return;

    if (ctx.from?.id === OWNER_USER_ID) {
      const text = ctx.message.text;
      if (text) await handleOwnerMessage(ctx, OWNER_USER_ID, text);
      return;
    }

    await ctx.reply(DIRECT_REPLY);
  });
}
