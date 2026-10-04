# Contributing

Thanks for helping! This project aims for parity with Linear's Slack integration on Feishu / Lark.

## Setup

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm dev
```

Run `pnpm typecheck && pnpm test` before opening a PR. Postgres-backed tests run only when `TEST_DATABASE_URL` points at a throwaway database (the tests truncate tables).

## Localization rules

All user-visible text lives in typed catalogs under `src/i18n/messages/`, one entry per key with both `zh-CN` and `en`:

```ts
"issue.created": { "zh-CN": "已创建 {identifier}", en: "Created {identifier}" },
```

- Use `t("key", params)` at render time. Never hard-code user-facing strings in cards, commands or notifications.
- Notifications render **per recipient** — build the card inside the per-recipient callback.
- Placeholders must match across languages; the `en` text must not contain Chinese. `src/i18n/i18n.test.ts` enforces both.
- Logs, API errors and config messages are English.
- Keep the tone professional and concise; prefer verbs ("Create issue") over exclamations.

## Database changes

Edit `src/db/schema.ts`, run `pnpm db:generate`, and commit the generated files in `drizzle/`.

## Conventions

- Platform SDK code lives in `src/adapters/`; business logic in `src/domain/` must not depend on HTTP.
- Feishu cards use JSON 2.0; callbacks must answer within 3 s — defer slow work and update the card afterwards.
- Never commit secrets, domains or account details. Deployment-specific config belongs in git-ignored files.
- Existing code comments are partly in Chinese; comments in either language are welcome.

## License

By contributing you agree that your contributions are licensed under AGPL-3.0-only.
