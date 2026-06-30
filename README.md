<div align="center">

# Secretary Bot

**An AI auto-responder for your personal Telegram account.**

When someone messages you, a bot connected via Telegram's Business (Secretary) Mode replies *as you* — in your voice, your language, and within your rules — powered by Google Gemini 2.5 Flash.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![grammY](https://img.shields.io/badge/grammY-1.30-009688)](https://grammy.dev/)
[![Gemini](https://img.shields.io/badge/Gemini-2.5%20Flash-4285F4?logo=google&logoColor=white)](https://ai.google.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#license)

</div>

---

## Overview

Secretary Bot uses Telegram's [Business Mode](https://core.telegram.org/bots#business) (also called *Chat Automation* / *Secretary Mode*) to handle incoming messages on your behalf. Unlike a generic chatbot, it's built to sound like **you**: it reads from a small set of your real example messages, mirrors your tone and language, and respects boundaries you define — so replies feel personal, not robotic.

> **Note:** Connecting a bot to your personal profile requires **Telegram Premium**.

## Features

- 🧠 **Speaks in your voice** — few-shot examples from your own messages teach it your tone, length, and style.
- 🌍 **Language-matching** — replies in whatever language the sender writes in.
- 💬 **Per-chat memory** — keeps the last 20 message pairs of context for each conversation.
- ⏰ **Time-aware** — grounded with your real local date/time, so it never fabricates "what time is it?"
- 🔇 **No leaked reasoning** — Gemini's internal thinking is disabled and sanitized so only the final message is sent.
- 🛡️ **Safe by design** — never replies to your own messages, respects Telegram's 24-hour window, and notifies you instead of sending a broken reply on failure.

## How it works

```
Someone messages YOU ──▶ Telegram ──(business_message)──▶ Secretary Bot ──▶ Gemini 2.5 Flash
                                                                              │
          Their chat  ◀──(sendMessage with business_connection_id)───────────┘
```

The bot subscribes to Telegram's `business_connection` and `business_message` updates. For each incoming message it composes a prompt (persona + your voice examples + per-message context + recent history), calls Gemini, and sends the reply back into the chat **as you** via the `business_connection_id` parameter.

## Prerequisites

- **Node.js ≥ 18**
- A **Telegram bot token** — from [@BotFather](https://t.me/BotFather)
- A **Google Gemini API key** — from [Google AI Studio](https://aistudio.google.com/apikey)
- **Telegram Premium** on the account you want the bot to manage

## Quick start

```bash
git clone https://github.com/dostonsulaymon/secretary-bot.git
cd secretary-bot
npm install
cp .env.example .env       # then fill in your values
npm run dev                # run from source
```

### 1. Enable Business Mode on the bot

In [@BotFather](https://t.me/BotFather): `/mybots` → select your bot → **Bot Settings** → **Business Mode** → **Enable**.

### 2. Connect the bot to your profile

In the Telegram app (Premium required): **Settings → Telegram Business → Chatbots** *(or **Chat Automation** on some clients)* → enter `@yourbotusername`, and grant the **"Reply to messages"** permission.

You'll receive a confirmation DM: `✅ Secretary Mode active`.

### 3. Personalize the voice (recommended)

```bash
cp voice.example.json voice.json    # voice.json is gitignored
```

Edit `voice.json` and paste **15–20 of your actual Telegram replies**, plus adjust the `style` hints. Examples teach tone far better than instructions — this is what makes replies sound like you. Restart the bot after editing.

## Configuration

All configuration lives in `.env` (see [`.env.example`](.env.example)):

| Variable | Required | Description |
|---|:---:|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | Bot token from BotFather |
| `GEMINI_API_KEY` | ✅ | Google Gemini API key |
| `OWNER_USER_ID` | ✅ | Your numeric Telegram ID ([@userinfobot](https://t.me/userinfobot)) — used to notify you and to ignore your own messages |
| `SYSTEM_PROMPT` | ✅ | Base persona / instructions for the model |
| `OWNER_TIMEZONE` | — | IANA timezone for date/time grounding (default `Asia/Tashkent`) |

## Production

Build and run under [pm2](https://pm2.keymetrics.io/):

```bash
npm run build
pm2 start ecosystem.config.js
pm2 save && pm2 startup     # survive reboots
pm2 logs secretary-bot
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Run from source via `ts-node` |
| `npm run typecheck` | Type-check without emitting (`tsc --noEmit`) |
| `npm run build` | Compile `src/` → `dist/` |
| `npm start` | Run the compiled build |

## Project structure

```
src/
├── index.ts              # entry point, bot setup, allowed_updates
├── handlers/
│   ├── business.ts       # business_connection + business_message (the core auto-responder)
│   └── direct.ts         # canned reply for direct messages to the bot
├── ai/
│   └── gemini.ts         # Gemini 2.5 Flash wrapper
├── profile/
│   └── voice.ts          # composes persona + style + voice examples into the system prompt
└── store/
    └── sessions.ts       # in-memory per-chat conversation memory
```

## Limitations

- **Memory is in-process** — conversation history is wiped on restart. Swap `src/store/sessions.ts` for Redis/SQLite to persist.
- **Text only** — non-text messages (photos, voice, stickers) are currently ignored.
- **Single instance** — long polling does not support multiple instances on the same token.
- **SDK** — uses the now-deprecated `@google/generative-ai`; migration to `@google/genai` is planned.

## Roadmap

- [x] Voice personalization via few-shot examples
- [x] Per-contact awareness (tone & rules per sender)
- [x] A personal facts / FAQ knowledge base
- [ ] Draft-approval mode for important contacts

## License

[MIT](LICENSE) © Doston Sulaymon
