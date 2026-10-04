import { LinearClient } from "@linear/sdk";
import { eq, sql } from "drizzle-orm";
import type { Env } from "../../config.js";
import type { Db } from "../../db/index.js";
import { schema } from "../../db/index.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("linear-client");

const TOKEN_URL = "https://api.linear.app/oauth/token";
const AUTHORIZE_URL = "https://linear.app/oauth/authorize";

export function createLinearClientFactory(config: Env, db: Db) {
  let cached: LinearClient | null = null;
  let cachedAppUserId: string | undefined = config.LINEAR_APP_USER_ID || undefined;

  async function getClient(): Promise<LinearClient> {
    if (config.LINEAR_AUTH_MODE === "api_key") {
      if (!cached) {
        cached = new LinearClient({ apiKey: config.LINEAR_API_KEY });
        log.info("Linear client: api_key mode");
      }
      return cached;
    }

    const token = await ensureOAuthToken(config, db);
    cached = new LinearClient({ accessToken: token.accessToken });
    if (token.appUserId) cachedAppUserId = token.appUserId;
    return cached;
  }

  async function getAppUserId(): Promise<string | undefined> {
    if (cachedAppUserId) return cachedAppUserId;
    if (config.LINEAR_AUTH_MODE === "api_key") {
      try {
        const client = await getClient();
        const viewer = await client.viewer;
        cachedAppUserId = viewer.id;
        return cachedAppUserId;
      } catch (err) {
        log.warn({ err }, "Failed to fetch the Linear viewer");
        return undefined;
      }
    }
    const [row] = await db.select().from(schema.linearTokens).limit(1);
    cachedAppUserId = row?.appUserId ?? undefined;
    return cachedAppUserId;
  }

  /** 下载 Linear 私有资源（uploads.linear.app）时使用的 Authorization 头 */
  async function getAuthHeader(): Promise<string> {
    if (config.LINEAR_AUTH_MODE === "api_key") return config.LINEAR_API_KEY;
    const token = await ensureOAuthToken(config, db);
    return `Bearer ${token.accessToken}`;
  }

  return { getClient, getAppUserId, getAuthHeader };
}

type TokenRow = typeof schema.linearTokens.$inferSelect;

function isFresh(row: TokenRow) {
  const expiresAt = row.expiresAt ? row.expiresAt.getTime() : 0;
  return Boolean(expiresAt) && Date.now() <= expiresAt - 5 * 60 * 1000;
}

async function ensureOAuthToken(config: Env, db: Db): Promise<TokenRow> {
  const [row] = await db.select().from(schema.linearTokens).limit(1);
  if (!row) {
    throw new Error(
      "Linear OAuth is not installed yet. Visit /oauth/linear/install",
    );
  }
  if (isFresh(row)) return row;

  // 多实例并发刷新会让 refresh_token 失效：用事务级 advisory lock 串行化，
  // 拿到锁后重新读取，若别的实例已刷新则直接复用。
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('linear_token_refresh'))`);
    const [latest] = await tx
      .select()
      .from(schema.linearTokens)
      .where(eq(schema.linearTokens.organizationId, row.organizationId))
      .limit(1);
    const current = latest ?? row;
    if (isFresh(current)) return current;

    if (!current.refreshToken) {
      throw new Error(
        "The Linear access token expired and there is no refresh_token. Re-install the OAuth app",
      );
    }

    log.info("Refreshing the Linear OAuth token");
    const refreshed = await refreshAccessToken(config, current.refreshToken);
    const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);

    const [updated] = await tx
      .update(schema.linearTokens)
      .set({
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token ?? current.refreshToken,
        expiresAt,
        scope: refreshed.scope ?? current.scope,
      })
      .where(eq(schema.linearTokens.organizationId, current.organizationId))
      .returning();
    return updated;
  });
}

export function buildAuthorizeUrl(config: Env, state: string): string {
  const redirect =
    config.LINEAR_REDIRECT_URI ||
    `${config.PUBLIC_URL}/oauth/linear/callback`;

  const params = new URLSearchParams({
    client_id: config.LINEAR_CLIENT_ID,
    redirect_uri: redirect,
    response_type: "code",
    scope: config.LINEAR_SCOPES,
    state,
    actor: "app",
  });

  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCode(
  config: Env,
  code: string,
): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}> {
  const redirect =
    config.LINEAR_REDIRECT_URI ||
    `${config.PUBLIC_URL}/oauth/linear/callback`;

  const body = new URLSearchParams({
    code,
    redirect_uri: redirect,
    client_id: config.LINEAR_CLIENT_ID,
    client_secret: config.LINEAR_CLIENT_SECRET,
    grant_type: "authorization_code",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Linear token exchange failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  }>;
}

async function refreshAccessToken(config: Env, refreshToken: string) {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    client_id: config.LINEAR_CLIENT_ID,
    client_secret: config.LINEAR_CLIENT_SECRET,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Linear token refresh failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  }>;
}

export async function persistOAuthToken(
  db: Db,
  opts: {
    organizationId: string;
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    scope?: string;
    appUserId?: string;
  },
) {
  const expiresAt = new Date(Date.now() + opts.expiresIn * 1000);

  await db.insert(schema.linearTokens)
    .values({
      organizationId: opts.organizationId,
      accessToken: opts.accessToken,
      refreshToken: opts.refreshToken,
      expiresAt,
      scope: opts.scope,
      appUserId: opts.appUserId,
    })
    .onConflictDoUpdate({
      target: schema.linearTokens.organizationId,
      set: {
        accessToken: opts.accessToken,
        refreshToken: opts.refreshToken,
        expiresAt,
        scope: opts.scope,
        appUserId: opts.appUserId,
      },
    });
}
