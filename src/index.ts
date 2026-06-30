import "dotenv/config";
import { Bot } from "grammy";
import { registerBusinessHandlers } from "./handlers/business";
import { registerDirectHandlers } from "./handlers/direct";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is not set in the environment");
}
if (!Number.isFinite(Number(process.env.OWNER_USER_ID))) {
  console.warn("OWNER_USER_ID is not set or not numeric — owner notifications and self-filtering are disabled.");
}

const bot = new Bot(token);

// Order matters only for clarity; business_* and message are distinct update types.
registerBusinessHandlers(bot);
registerDirectHandlers(bot);

// Global error boundary — never let a handler crash the process.
bot.catch((err) => {
  console.error(`Error while handling update ${err.ctx.update.update_id}:`, err.error);
});

async function main(): Promise<void> {
  // Long polling and webhooks are mutually exclusive — clear any stale webhook.
  await bot.api.deleteWebhook({ drop_pending_updates: false }).catch(() => undefined);

  console.log("Starting Secretary Mode bot…");
  await bot.start({
    // Business updates are NOT delivered unless explicitly requested.
    allowed_updates: [
      "message",
      "business_connection",
      "business_message",
      "edited_business_message",
      "deleted_business_messages",
    ],
    onStart: (info) => console.log(`@${info.username} is live in Secretary Mode.`),
  });
}

// Graceful shutdown.
process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
