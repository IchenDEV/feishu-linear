# Security policy

## Reporting a vulnerability

Please **do not** open a public issue. Report it privately through
[GitHub Security Advisories](https://github.com/IchenDEV/feishu-linear/security/advisories/new).
We aim to acknowledge reports within 3 working days.

## Scope and design notes

- Every Feishu event / callback is verified against `FEISHU_VERIFICATION_TOKEN` (and the signature when an Encrypt Key is set).
- Linear webhooks are verified with HMAC using `LINEAR_WEBHOOK_SECRET` and a timestamp window.
- `/api/*` requires `ADMIN_TOKEN`, `/cron/*` requires `CRON_SECRET`, `/mcp` requires `MCP_TOKEN`; each is disabled when its token is unset.
- Identity binding: manual `/linear bind <email>` only accepts the caller's own Feishu email; arbitrary bindings require the admin API.
- Secrets belong in environment variables / platform secret stores. `.env`, `.dev.vars` and `wrangler.jsonc` are git-ignored — never commit them.

If you ever committed a secret, rotate it immediately; removing it from history is not enough.
