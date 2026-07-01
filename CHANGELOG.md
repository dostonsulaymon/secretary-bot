# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Voice personalization via few-shot examples (`voice.json`).
- Per-contact awareness — tone, gender, and rules per sender (`contacts.json`).
- Paste-to-learn: extract relationship, tone, and example exchanges from a pasted conversation.
- Personal facts / FAQ knowledge base (`facts.json`) with an anti-hallucination guard.
- Interactive owner control panel — manage contacts and facts by DMing the bot (natural language), including bulk clear with confirmation.
- Human reply pacing — bursty, momentum-aware typing delays.
- Real-time date/time grounding per message.
- Retry with backoff on transient Gemini errors.
- Direct handling of `/start` and `/help` (no wasted API calls).

### Changed
- First-person persona so the bot replies *as* the owner rather than as a third-party assistant.

### Fixed
- Gemini 2.5 Flash "thinking" leaking into replies (disabled + sanitized).

[Unreleased]: https://github.com/dostonsulaymon/secretary-bot/commits/main
