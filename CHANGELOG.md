# Changelog

## 0.4.0

- **Localization:** full 简体中文 / English support across cards, commands, notifications, thread sync, agent replies, MCP and H5. Locale resolves per user → chat → workspace (`DEFAULT_LOCALE`), switchable with `/linear lang` and in the settings cards. Notifications render in each recipient's language.
- **Identity binding hardening:** manual `/linear bind <email>` must match the caller's own Feishu email.
- **Onboarding:** `pnpm setup:check` audits Feishu scopes / callbacks / slash commands, the Linear webhook, the database schema and reachability; `--register-commands` and `--create-linear-webhook` automate setup. New bilingual installation guide.
- Database: new `locale` columns (migration `0002_locale`) — run `pnpm db:migrate`.
- Logs, API errors and config messages are now English.

## 0.3.0

- Feature parity with Linear × Slack: agent, issue creation entry points (message shortcut H5, `/linear`), two-way thread sync, five-layer notifications, project channels, link unfurling, MCP endpoint, Asks, permissions and admin settings.
