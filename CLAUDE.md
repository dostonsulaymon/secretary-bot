# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install deps
npm run dev          # run from source via ts-node (no build)
npm run typecheck    # tsc --noEmit — the only "test" gate; run after edits
npm run build        # compile src/ -> dist/
npm start            # run compiled dist/index.js (used in production)
```

There is **no test suite**. `npm run typecheck` is the correctness gate — `tsconfig.json` runs in `strict` mode with `noUncheckedIndexedAccess`, so optional/undefined narrowing is enforced. Production runs the compiled output under pm2 (`ecosystem.config.js`).

## What this is

A Telegram **Secretary Mode** (Business Mode) bot: when someone messages the *owner's* Telegram account, Telegram forwards it to this bot, which replies on the owner's behalf using Google Gemini 2.5 Flash. Requires Telegram Premium on the owner's account to connect. Config is via `.env` (see `.env.example`); `OWNER_USER_ID` is the owner's numeric Telegram ID.

## Architecture — the non-obvious parts

**Two separate update streams that must not be confused:**
- `business_message` → the auto-responder (`src/handlers/business.ts`). Messages *to the owner* in managed chats.
- normal `message` → a static canned reply (`src/handlers/direct.ts`). Messages sent *directly to the bot*.

Business messages arrive as `business_message` updates and **never** trigger the `message` handler, so the two handlers don't overlap.

**`allowed_updates` is load-bearing.** Telegram does *not* deliver `business_*` updates unless they're explicitly listed in `bot.start({ allowed_updates: [...] })` in `src/index.ts`. Dropping them there silently breaks the entire bot with no error.

**Reply flow** (`business_message` handler):
1. Skip if no text, no `business_connection_id`, or sender is the owner (`from.id === OWNER_USER_ID`) — prevents the bot replying to itself.
2. Skip if the connection's `can_reply` is false.
3. Call Gemini with per-chat history.
4. `ctx.api.sendMessage(chatId, reply, { business_connection_id })` — the `business_connection_id` option is what makes the reply go out *as the owner*. Omitting it sends as the bot.
5. **History is persisted only after a successful send**, so a failed send never poisons the conversation context.

**Voice profile** (`src/profile/voice.ts`): `buildSystemPrompt(base)` composes the final Gemini system instruction from `SYSTEM_PROMPT` + style hints + few-shot examples loaded from `voice.json` (gitignored real file) or `voice.example.json` (committed fallback). Composed **once** at startup in `business.ts` (`COMPOSED_SYSTEM_PROMPT`), so editing `voice.json` requires a restart. The examples are what make replies sound like the owner rather than a generic assistant — prefer adding real example pairs over lengthening the prompt.

**Contacts** (`src/profile/contacts.ts`): `getContactContext(chatId, username)` returns a per-message context line ("You are talking to X (client). Tone: … Notes: …") resolved by `chat_id` first, then `@username`, then a `default`. Loaded from `contacts.json` (gitignored) or `contacts.example.json` (fallback). This is where per-sender tone *and rules* live (e.g. "never quote a price"). The final system prompt in `business.ts` is `COMPOSED_SYSTEM_PROMPT + ownerContext() + getContactContext(...)`, joined per message.

**Facts / knowledge base** (`src/profile/facts.ts`): `buildFactsContext()` injects `facts` (statements the bot may rely on) + `faq` (question→answer guidance) from `facts.json` (gitignored) or `facts.example.json`. It **always** appends a hard guard against inventing personal/sensitive details (relationships, finances, address, plans) even when no facts file exists — without it the model confidently fabricates personal facts (e.g. stating a marital status). Composed once at startup as `FACTS_CONTEXT` in `business.ts`.

The full per-message system prompt order is: `COMPOSED_SYSTEM_PROMPT + FACTS_CONTEXT + ownerContext() + getContactContext(...)`.

**Session store** (`src/store/sessions.ts`): in-memory `Map` keyed by `` `${business_connection_id}:${chat_id}` ``, capped at 40 entries (20 pairs). Roles use Gemini's convention — `"user"` (incoming) / `"model"` (our reply), *not* OpenAI's `assistant`. History must start with a `user` turn; the append order (user then model) guarantees this. **Memory is process-local and wiped on restart** — swap for Redis/SQLite if persistence is needed.

**Connection lifecycle** (`business_connection` handler): stores/clears `ConnectionInfo` in a module-level map and DMs the owner on connect/disconnect. `can_reply` is read defensively via `extractCanReply()` because Bot API 9.0 moved it from the connection root into `rights.can_reply` — read both to survive either grammY/types version.

**Error handling deliberately stays silent in two cases:** `BUSINESS_CHAT_INACTIVE` (the message is outside Telegram's 24h reply window) is skipped without notice; Gemini failures notify the owner but send *no* reply rather than a broken one. Never replace these with a fallback/placeholder message to the contact.

## Gotchas

- **`@google/generative-ai` is deprecated** in favor of `@google/genai`. It still works with `gemini-2.5-flash`; if you touch `src/ai/gemini.ts`, consider migrating.
- Only **text** messages are handled — photos/voice/stickers are ignored in the `business_message` handler. Extend there to support them.
- Long polling means **one instance per token** — running two concurrently conflicts.
