# Security Policy

Secretary Bot connects to a personal Telegram account and handles private messages, API keys, and stored personal data. Please treat security issues seriously.

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Instead, report privately via [GitHub's private vulnerability reporting](https://github.com/dostonsulaymon/secretary-bot/security/advisories/new), or email **dostonibnsulaymon@gmail.com**.

Please include:
- A description of the issue and its impact
- Steps to reproduce
- Any suggested fix

You can expect an initial response within a few days.

## Handling secrets & personal data

- `TELEGRAM_BOT_TOKEN` and `GEMINI_API_KEY` live in `.env`, which is **gitignored**. Never commit them.
- `voice.json`, `contacts.json`, and `facts.json` hold personal data and are **gitignored**. Only the `*.example.json` templates are tracked.
- If a token is ever exposed (e.g. pasted in an issue), **revoke and rotate it immediately** — BotFather for the Telegram token, Google AI Studio for the Gemini key.
- The bot only receives messages after connection; it has no access to prior chat history (Telegram Bot API limitation).

## Scope

This project is provided as-is under the MIT License. Run it on infrastructure you trust; you are responsible for the account it manages.
