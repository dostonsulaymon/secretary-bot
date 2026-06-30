# Secretary Bot

A Telegram **Secretary Mode** (Business Mode) bot that auto-responds to people who message *you*, replying on your behalf with **Google Gemini 2.5 Flash**.

Built with **TypeScript + Node.js + [grammY](https://grammy.dev)**.

> ⚠️ Secretary Mode / Chat Automation requires **Telegram Premium**. Without it, Telegram won't let you connect a bot to your profile.

---

## How it works

```
Someone messages YOU ──▶ Telegram ──(business_message)──▶ this bot ──▶ Gemini 2.5 Flash
                                                                          │
        Their chat  ◀──(ctx.api.sendMessage with business_connection_id)──┘
```

- The bot listens for `business_connection` (you connecting/disconnecting) and `business_message` (messages in your managed chats).
- Each chat gets its own conversation memory (last 20 message pairs, in-memory).
- Your own outgoing messages are ignored, so the bot never talks to itself.
- Messages outside Telegram's 24-hour activity window (`BUSINESS_CHAT_INACTIVE`) are skipped silently.

---

## Project structure

```
secretary-bot/
├── src/
│   ├── index.ts            # entry point, bot setup, allowed_updates
│   ├── handlers/
│   │   ├── business.ts     # business_connection + business_message handlers
│   │   └── direct.ts       # canned reply for direct messages to the bot
│   ├── ai/
│   │   └── gemini.ts       # Gemini 2.5 Flash wrapper
│   └── store/
│       └── sessions.ts     # in-memory conversation store (Map)
├── ecosystem.config.js     # pm2 production config
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## 1. Create the bot & enable Secretary Mode (BotFather)

1. Open [@BotFather](https://t.me/BotFather) → `/newbot` → grab the **bot token**.
2. `/mybots` → select your bot → **Bot Settings** → **Business Mode** (a.k.a. Secretary Mode) → **Enable**.

## 2. Connect the bot to your Telegram profile

On your phone/desktop Telegram (Premium required):

**Settings → Telegram Business → Chatbots** *(or* **Settings → Chat Automation** *on some clients)* → enter `@yourbotusername`.

Make sure **"Reply to messages"** permission is granted — without it the bot can read but not respond (`can_reply = false`).

When connected, you'll get a confirmation DM from the bot: `✅ Secretary Mode active. Connection ID: …`.

## 3. Configure `.env`

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From BotFather |
| `GEMINI_API_KEY` | From [Google AI Studio](https://aistudio.google.com/apikey) |
| `OWNER_USER_ID` | Your numeric Telegram ID (from [@userinfobot](https://t.me/userinfobot)). Used to notify you and to filter out your own messages |
| `SYSTEM_PROMPT` | Persona/instructions for Gemini (single line) |

## 4. Install & run

```bash
npm install

# Development (ts-node, no build step)
npm run dev

# Production
npm run build
npm start
```

### Run with pm2 (production)

```bash
npm run build
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save            # persist across reboots
pm2 startup         # follow the printed instruction to enable on boot
pm2 logs secretary-bot
```

---

## Notes & limitations

- **Memory is in-process.** Restarting the bot wipes conversation history. Swap `src/store/sessions.ts` for Redis/SQLite if you need persistence.
- **Text only.** Non-text messages (photos, voice, stickers) are currently ignored. Extend `business_message` in `src/handlers/business.ts` to handle them.
- **One instance only.** Long polling doesn't support multiple concurrent instances on the same token.
- **`@google/generative-ai` is deprecated** in favor of `@google/genai`. It still works with `gemini-2.5-flash`; migrate when convenient.
