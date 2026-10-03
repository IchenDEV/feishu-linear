import { LinearClient } from "@linear/sdk";
import { eq } from "drizzle-orm";
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
        log.info("Linear client: api_key 模式");
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
        log.warn({ err }, "获取 Linear viewer 失败");
        return undefined;
      }
    }
    const row = db.select().from(schema.linearTokens).all()[0];
    cachedAppUserId = row?.appUserId ?? undefined;
    return cachedAppUserId;
  }

  return { getClient, getAppUserId };
}

async function ensureOAuthToken(config: Env, db: Db) {
  const row = db.select().from(schema.linearTokens).all()[0];
  if (!row) {
    throw new Error(
      "尚未完成 Linear OAuth 安装。请访问 /oauth/linear/install",
    );
  }

  const expiresAt = row.expiresAt ? new Date(row.expiresAt).getTime() : 0;
  const needsRefresh = !expiresAt || Date.now() > expiresAt - 5 * 60 * 1000;

  if (!needsRefresh) {
    return row;
  }

  if (!row.refreshToken) {
    throw new Error("Linear access token 已过期且无 refresh_token，请重新安装 OAuth");
  }

  log.info("刷新 Linear OAuth token");
  const refreshed = await refreshAccessToken(config, row.refreshToken);

  const expiresAtIso = new Date(
    Date.now() + refreshed.expires_in * 1000,
  ).toISOString();

  db.update(schema.linearTokens)
    .set({
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? row.refreshToken,
      expiresAt: expiresAtIso,
      scope: refreshed.scope ?? row.scope,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.linearTokens.organizationId, row.organizationId))
    .run();

  return {
    ...row,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? row.refreshToken,
    expiresAt: expiresAtIso,
  };
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
  const expiresAt = new Date(Date.now() + opts.expiresIn * 1000).toISOString();

  db.insert(schema.linearTokens)
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
        updatedAt: new Date().toISOString(),
      },
    })
    .run();
}
