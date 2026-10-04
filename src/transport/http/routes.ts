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
import { requireBearer } from "./middleware.js";
import { cleanupOldEvents } from "../../utils/dedup.js";
import { createSyncThreadForIssue } from "../../domain/sync/threads.js";
import { createProjectChannel } from "../../domain/notify/engine.js";
import { handleRpc } from "../../domain/mcp/server.js";
import { pollViewSubscriptions } from "../../domain/notify/views.js";
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
      version: "0.3.0",
      uptime: process.uptime(),
      linearAuth: ctx.config.LINEAR_AUTH_MODE,
    };
  });

  // ── 飞书：事件 / 卡片回调 / 链接预览 共用同一个请求地址 ──
  router.post(
    "/webhook/feishu",
    createFeishuWebhookMiddleware(
      feishuDispatcher,
      ctx.config.FEISHU_VERIFICATION_TOKEN,
    ),
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
    await ctx.db.insert(schema.oauthStates).values({ state });
    koaCtx.redirect(buildAuthorizeUrl(ctx.config, state));
  });

  router.get("/oauth/linear/callback", async (koaCtx) => {
    const { code, state } = koaCtx.query as Record<string, string>;
    if (!code || !state) {
      koaCtx.status = 400;
      koaCtx.body = { error: "缺少 code/state" };
      return;
    }

    const [row] = await ctx.db
      .select()
      .from(schema.oauthStates)
      .where(eq(schema.oauthStates.state, state))
      .limit(1);
    if (!row) {
      koaCtx.status = 400;
      koaCtx.body = { error: "无效 state" };
      return;
    }
    await ctx.db
      .delete(schema.oauthStates)
      .where(eq(schema.oauthStates.state, state));

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

  // ── 定时清理（Vercel Cron 调用；VPS 上由进程内定时器负责）──
  router.get(
    "/cron/cleanup",
    requireBearer(() => ctx.config.CRON_SECRET, "Cron"),
    async (koaCtx) => {
      await cleanupOldEvents(ctx.db);
      koaCtx.body = { ok: true };
    },
  );

  // ── MCP（Streamable HTTP，无状态）：Bearer MCP_TOKEN ──
  router.post(
    "/mcp",
    requireBearer(() => ctx.config.MCP_TOKEN, "MCP"),
    async (koaCtx) => {
      const body = koaCtx.request.body as unknown;
      const batch = Array.isArray(body) ? body : [body];
      const out = (
        await Promise.all(batch.map((m) => handleRpc(ctx, m as Parameters<typeof handleRpc>[1])))
      ).filter((x) => x !== null);
      if (!out.length) {
        koaCtx.status = 202;
        return;
      }
      koaCtx.body = Array.isArray(body) ? out : out[0];
    },
  );
  router.get("/mcp", (koaCtx) => {
    koaCtx.status = 405; // 不提供服务端推送流
  });

  // ── 视图订阅轮询（Vercel Cron / Workers cron 调用；VPS 上由进程内定时器负责）──
  router.get(
    "/cron/views",
    requireBearer(() => ctx.config.CRON_SECRET, "Cron"),
    async (koaCtx) => {
      koaCtx.body = { ok: true, ...(await pollViewSubscriptions(ctx)) };
    },
  );

  // ── 管理 API（Bearer ADMIN_TOKEN）──
  router.use("/api", requireBearer(() => ctx.config.ADMIN_TOKEN, "管理 API"));

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
    const [result] = await ctx.db
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
      .returning();
    koaCtx.body = { success: true, config: result };
  });

  router.post("/api/guidance", async (koaCtx) => {
    const body = koaCtx.request.body as Record<string, unknown>;
    if (!body.feishuChatId || !body.guidance) {
      koaCtx.status = 400;
      koaCtx.body = { error: "需要 feishuChatId 和 guidance" };
      return;
    }
    await ctx.db
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
        },
      });
    koaCtx.body = { success: true };
  });

  /** 为已有 Issue 与飞书话题建立同步（rootMessageId = 话题根消息） */
  router.post("/api/sync-thread", async (koaCtx) => {
    const b = koaCtx.request.body as Record<string, string>;
    if (!b.issueKey || !b.chatId || !b.rootMessageId) {
      koaCtx.status = 400;
      koaCtx.body = { error: "需要 issueKey、chatId、rootMessageId" };
      return;
    }
    try {
      const row = await createSyncThreadForIssue(ctx, {
        issueKey: b.issueKey,
        chatId: b.chatId,
        rootMessageId: b.rootMessageId,
      });
      koaCtx.body = { success: true, threadId: row?.feishuThreadId };
    } catch (err) {
      koaCtx.status = 500;
      koaCtx.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  /** 为 Linear 项目创建专属飞书群 */
  router.post("/api/project-channel", async (koaCtx) => {
    const b = koaCtx.request.body as Record<string, string>;
    if (!b.projectId) {
      koaCtx.status = 400;
      koaCtx.body = { error: "需要 projectId" };
      return;
    }
    try {
      const row = await createProjectChannel(ctx, { projectId: b.projectId, autoCreated: false });
      koaCtx.body = { success: true, chatId: row?.feishuChatId };
    } catch (err) {
      koaCtx.status = 500;
      koaCtx.body = { error: err instanceof Error ? err.message : String(err) };
    }
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
