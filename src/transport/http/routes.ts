import Router from "@koa/router";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { EventDispatcher } from "@larksuiteoapi/node-sdk";
import type { AppContext } from "../../app/context.js";
import { schema } from "../../db/index.js";
import {
  createFeishuWebhookMiddleware,
} from "../../adapters/feishu/dispatcher.js";
import { createLinearWebhookMiddleware } from "../../adapters/linear/webhook.js";
import {
  buildAuthorizeUrl,
  exchangeCode,
  persistOAuthToken,
} from "../../adapters/linear/client.js";
import * as linearApi from "../../adapters/linear/api.js";
import { bindByEmail } from "../../domain/users/mapping.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("http");

export function createRouter(
  ctx: AppContext,
  feishuDispatcher: EventDispatcher,
) {
  const router = new Router();

  router.get("/health", (koaCtx) => {
    koaCtx.body = {
      status: "ok",
      version: "0.2.0",
      uptime: process.uptime(),
      feishuTransport: ctx.config.FEISHU_TRANSPORT,
      linearAuth: ctx.config.LINEAR_AUTH_MODE,
    };
  });

  // ── 飞书：官方 EventDispatcher（事件 + 卡片回调 + 链接预览 同一入口）──
  // 开发者后台可将事件/回调 URL 都指到此路径
  router.post(
    "/webhook/feishu",
    createFeishuWebhookMiddleware(feishuDispatcher),
  );
  // 兼容旧路径
  router.post(
    "/webhook/feishu/event",
    createFeishuWebhookMiddleware(feishuDispatcher),
  );
  router.post(
    "/webhook/feishu/card",
    createFeishuWebhookMiddleware(feishuDispatcher),
  );
  router.post(
    "/webhook/feishu/link-preview",
    createFeishuWebhookMiddleware(feishuDispatcher),
  );

  // ── Linear Webhook ──
  router.post("/webhook/linear", createLinearWebhookMiddleware(ctx));

  // ── Linear OAuth（actor=app）──
  router.get("/oauth/linear/install", async (koaCtx) => {
    if (ctx.config.LINEAR_AUTH_MODE !== "oauth") {
      koaCtx.status = 400;
      koaCtx.body = { error: "当前 LINEAR_AUTH_MODE 不是 oauth" };
      return;
    }
    const state = nanoid(24);
    ctx.db.insert(schema.oauthStates).values({ state }).run();
    koaCtx.redirect(buildAuthorizeUrl(ctx.config, state));
  });

  router.get("/oauth/linear/callback", async (koaCtx) => {
    const { code, state } = koaCtx.query as Record<string, string>;
    if (!code || !state) {
      koaCtx.status = 400;
      koaCtx.body = { error: "缺少 code/state" };
      return;
    }

    const row = ctx.db
      .select()
      .from(schema.oauthStates)
      .where(eq(schema.oauthStates.state, state))
      .get();
    if (!row) {
      koaCtx.status = 400;
      koaCtx.body = { error: "无效 state" };
      return;
    }
    ctx.db
      .delete(schema.oauthStates)
      .where(eq(schema.oauthStates.state, state))
      .run();

    try {
      const token = await exchangeCode(ctx.config, code);
      const tempClient = new (
        await import("@linear/sdk")
      ).LinearClient({ accessToken: token.access_token });
      const org = await tempClient.organization;
      const viewer = await tempClient.viewer;

      await persistOAuthToken(ctx.db, {
        organizationId: org.id,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresIn: token.expires_in,
        scope: token.scope,
        appUserId: viewer.id,
      });

      log.info(
        { org: org.name, appUser: viewer.id },
        "Linear OAuth 安装成功",
      );

      koaCtx.body = {
        success: true,
        organization: org.name,
        appUserId: viewer.id,
        message: "Linear 应用已安装。可将 LINEAR_APP_USER_ID 设为 appUserId。",
      };
    } catch (err) {
      log.error({ err }, "OAuth callback 失败");
      koaCtx.status = 500;
      koaCtx.body = {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // ── 管理 API ──
  router.post("/api/bind", async (koaCtx) => {
    const body = koaCtx.request.body as Record<string, string>;
    if (!body.feishuOpenId || !body.linearEmail) {
      koaCtx.status = 400;
      koaCtx.body = { error: "需要 feishuOpenId 和 linearEmail" };
      return;
    }
    try {
      const bound = await bindByEmail(ctx, {
        feishuOpenId: body.feishuOpenId,
        linearEmail: body.linearEmail,
        feishuName: body.feishuName,
      });
      koaCtx.body = { success: true, ...bound };
    } catch (err) {
      koaCtx.status = 500;
      koaCtx.body = {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  router.post("/api/notification", async (koaCtx) => {
    const body = koaCtx.request.body as Record<string, unknown>;
    if (!body.type || !body.linearEntityId) {
      koaCtx.status = 400;
      koaCtx.body = { error: "需要 type 和 linearEntityId" };
      return;
    }
    const [result] = ctx.db
      .insert(schema.notificationConfigs)
      .values({
        type: body.type as "team" | "project" | "initiative" | "view" | "personal",
        linearEntityId: String(body.linearEntityId),
        linearEntityName: body.linearEntityName as string | undefined,
        feishuChatId: body.feishuChatId as string | undefined,
        feishuUserId: body.feishuUserId as string | undefined,
        onCreated: (body.onCreated as boolean) ?? true,
        onUpdated: (body.onUpdated as boolean) ?? true,
        onCompleted: (body.onCompleted as boolean) ?? false,
        onComment: (body.onComment as boolean) ?? true,
        createdBy: body.createdBy as string | undefined,
      })
      .returning()
      .all();
    koaCtx.body = { success: true, config: result };
  });

  router.post("/api/guidance", async (koaCtx) => {
    const body = koaCtx.request.body as Record<string, unknown>;
    if (!body.feishuChatId || !body.guidance) {
      koaCtx.status = 400;
      koaCtx.body = { error: "需要 feishuChatId 和 guidance" };
      return;
    }
    ctx.db
      .insert(schema.agentGuidance)
      .values({
        feishuChatId: String(body.feishuChatId),
        guidance: String(body.guidance),
        defaultTeamId: body.defaultTeamId as string | undefined,
        defaultProjectId: body.defaultProjectId as string | undefined,
      })
      .onConflictDoUpdate({
        target: schema.agentGuidance.feishuChatId,
        set: {
          guidance: String(body.guidance),
          defaultTeamId: body.defaultTeamId as string | undefined,
          defaultProjectId: body.defaultProjectId as string | undefined,
          updatedAt: new Date().toISOString(),
        },
      })
      .run();
    koaCtx.body = { success: true };
  });

  router.get("/api/teams", async (koaCtx) => {
    try {
      const linear = await ctx.getLinear();
      const teams = await linearApi.getTeams(linear);
      koaCtx.body = {
        teams: teams.map((t) => ({ id: t.id, name: t.name, key: t.key })),
      };
    } catch (err) {
      koaCtx.status = 500;
      koaCtx.body = {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  return router;
}
