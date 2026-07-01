# Contributing to Secretary Bot

Thanks for your interest in improving Secretary Bot! Contributions of all kinds are welcome — bug reports, features, docs, and tests.

## Getting started

```bash
git clone https://github.com/dostonsulaymon/secretary-bot.git
cd secretary-bot
npm install
cp .env.example .env    # fill in your own tokens
npm run dev
```

You'll need Node.js ≥ 18, a Telegram bot token (with Business Mode enabled), and a Google Gemini API key. See the [README](README.md) for full setup.

## Development workflow

- **Type-check is the gate.** There is no unit-test suite yet; `npm run typecheck` must pass (strict mode, `noUncheckedIndexedAccess`). Run it before every commit.
- **Build** with `npm run build` to confirm the compile output is clean.
- Keep changes focused — one concern per PR.
- Match the surrounding code style: existing naming, comment density, and idioms. Don't add comments unless the logic is non-obvious.

## Commit & PR guidelines

- Write clear, imperative commit messages ("Add contact escalation guard", not "added stuff").
- Reference related issues (`Fixes #123`).
- Open a PR against `main`. Fill in the PR template. Make sure CI is green.
- If you change behavior, update the README and `CLAUDE.md` accordingly.

## Security

Never commit secrets. `.env`, `voice.json`, `contacts.json`, and `facts.json` are gitignored on purpose — they hold personal data and credentials. See [SECURITY.md](SECURITY.md) to report vulnerabilities.

## Code of Conduct

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).
