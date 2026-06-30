import { Bot } from "grammy";

const OWNER_USER_ID = Number(process.env.OWNER_USER_ID);

const DIRECT_REPLY =
  "This bot is Doston's personal secretary. You can reach him by messaging him directly.";

/**
 * Handles normal (non-business) messages sent directly to the bot.
 * Business messages arrive as `business_message` updates, so they never hit this.
 */
export function registerDirectHandlers(bot: Bot): void {
  bot.on("message", async (ctx) => {
    // Only respond in private chats — ignore groups/channels the bot is added to.
    if (ctx.chat.type !== "private") return;

    // Don't bother the owner with the canned reply.
    if (ctx.from?.id === OWNER_USER_ID) return;

    await ctx.reply(DIRECT_REPLY);
  });
}
