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
- 👥 **Per-contact awareness** — set tone, gender, and rules per sender (casual with friends, "never quote a price" to clients).
- 🗣️ **Configure by chat** — DM the bot *"treat @ali as my client, formal, he's a he"* and it parses, confirms, and saves the contact — no file editing, no restart.
- 📇 **Personal knowledge base** — answers from a facts/FAQ file, and refuses to invent personal details it doesn't know.
- ⌨️ **Natural pacing** — shows a "typing…" indicator and delays replies proportional to length (with jitter), so it never answers at robot speed.
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
- **Business (Secretary) Mode enabled** on that bot in BotFather — see [step 1](#1-enable-business-mode-on-the-bot). Without it, Telegram won't deliver the `business_message` updates the bot depends on, and nothing will work.
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

### 3. Personalize it (recommended)

Three optional, gitignored files shape how the bot behaves. Each ships with a committed `*.example.json` template — copy and edit:

```bash
cp voice.example.json    voice.json      # how you talk
cp contacts.example.json contacts.json   # who you talk to
cp facts.example.json    facts.json      # what you know
```

- **`voice.json`** — paste **15–20 of your real Telegram replies** plus `style` hints. Examples teach tone far better than instructions; this is what makes replies sound like you.
- **`contacts.json`** — per-sender `tone`, `relationship`, and `notes`/rules, keyed by `chat_id` or `@username`. A `default` entry covers everyone else.
- **`facts.json`** — `facts` the bot may rely on and `faq` guidance. It answers from these and refuses to invent personal details beyond them.

Restart the bot after editing — these load once at startup.

> **Tip:** You don't have to edit `contacts.json` by hand. Just **DM the bot** (from your owner account) in plain language:
> - *"treat @ali as my client, keep it formal, he's a he, never quote prices"* → it shows a card and saves on your **"yes"**
> - *"my sister @dilnoza, be warm with her"*, *"who is @ali"*, *"list my contacts"*, *"forget @ali"*
>
> Contacts saved this way persist immediately — no restart. To tag someone without a public `@username`, use their numeric `chat_id` (the bot logs each sender's id when they message you).

## Configuration

All configuration lives in `.env` (see [`.env.example`](.env.example)):

| Variable | Required | Description |
|---|:---:|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | Bot token from BotFather |
| `GEMINI_API_KEY` | ✅ | Google Gemini API key |
| `OWNER_USER_ID` | ✅ | Your numeric Telegram ID ([@userinfobot](https://t.me/userinfobot)) — used to notify you and to ignore your own messages |
| `SYSTEM_PROMPT` | ✅ | Base persona / instructions for the model |
| `OWNER_TIMEZONE` | — | IANA timezone for date/time grounding (default `Asia/Tashkent`) |
| `NATURAL_TYPING` | — | Show "typing…" and delay replies to feel human; `false` to reply instantly (default `true`) |

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
│   ├── direct.ts         # routes owner DMs to admin; canned reply for everyone else
│   └── admin.ts          # owner control panel — manage contacts by chatting with the bot
├── ai/
│   └── gemini.ts         # Gemini 2.5 Flash wrapper
├── profile/
│   ├── voice.ts          # persona + style + voice examples → system prompt
│   ├── contacts.ts       # per-sender tone & rules lookup (by chat_id / @username)
│   └── facts.ts          # facts/FAQ knowledge base + anti-hallucination guard
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
- [x] Interactive owner control — manage contacts by DMing the bot
- [ ] Draft-approval mode for important contacts

## License

[MIT](LICENSE) © Doston Sulaymon
