import type { Context, Next } from "koa";
import {
  LinearWebhookClient,
  LINEAR_WEBHOOK_SIGNATURE_HEADER,
  type LinearWebhookPayload,
} from "@linear/sdk/webhooks";
import type { AppContext } from "../../app/context.js";
import { isDuplicate } from "../../utils/dedup.js";
import { runInBackground } from "../../utils/background.js";
import { handleLinearEvent } from "../../domain/notify/events.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("linear-webhook");

/**
 * Linear 官方验签：HMAC-SHA256(rawBody) + webhookTimestamp（毫秒，±60s）
 * 注意：不能用自己重新 stringify 的 JSON，必须用 rawBody。
 */
export function createLinearWebhookMiddleware(ctx: AppContext) {
  const secret = ctx.config.LINEAR_WEBHOOK_SECRET;

  return async (koaCtx: Context, next: Next) => {
    if (!secret) {
      log.warn("LINEAR_WEBHOOK_SECRET is not set; skipping signature verification (development only)");
      await handlePayload(ctx, koaCtx.request.body as LinearWebhookPayload);
      koaCtx.status = 200;
      koaCtx.body = { ok: true };
      return;
    }

    const client = new LinearWebhookClient(secret);
    const signature = koaCtx.get(LINEAR_WEBHOOK_SIGNATURE_HEADER);
    const rawBody = koaCtx.request.rawBody;

    if (!rawBody || !signature) {
      koaCtx.status = 401;
      koaCtx.body = { error: "Missing signature or body" };
      return;
    }

    let payload: LinearWebhookPayload;
    try {
      // webhookTimestamp 在 body 内，单位毫秒；SDK verify 会校验 ±60s
      const parsed = JSON.parse(rawBody.toString()) as LinearWebhookPayload & {
        webhookTimestamp?: number;
      };
      client.verify(rawBody, signature, parsed.webhookTimestamp);
      payload = parsed;
    } catch (err) {
      log.warn({ err }, "Linear webhook signature verification failed");
      koaCtx.status = 401;
      koaCtx.body = { error: "Invalid signature" };
      return;
    }

    // 先 200，再异步处理（Linear 要求快速 ACK）
    koaCtx.status = 200;
    koaCtx.body = { ok: true };

    runInBackground("linear-webhook", () => handlePayload(ctx, payload));

    await next();
  };
}

async function handlePayload(ctx: AppContext, payload: LinearWebhookPayload) {
  const p = payload as unknown as {
    type?: string;
    action?: string;
    data?: Record<string, unknown>;
    actor?: { id?: string; name?: string };
    url?: string;
    updatedFrom?: Record<string, unknown>;
    createdAt?: string | Date;
  };
  const data = p.data ?? {};
  const createdAt =
    p.createdAt instanceof Date
      ? p.createdAt.toISOString()
      : (p.createdAt ?? "");

  // 防回声：OAuth(actor=app) 模式下忽略机器人自身触发的事件。
  // api_key mode下机器人就是 key 所有者本人，不能整体过滤（否则会吞掉本人在 Linear 里的真实操作），
  // 飞书写入 Linear 的回声由同步表 + 「（来自飞书）」标记去重。
  if (ctx.config.LINEAR_AUTH_MODE === "oauth") {
    const appUserId = await ctx.getLinearAppUserId();
    if (appUserId && p.actor?.id === appUserId) {
      log.debug({ type: p.type, action: p.action }, "Skipping own event");
      return;
    }
  }

  const eventId = `linear:${p.type}:${p.action}:${data.id}:${createdAt}`;
  if (await isDuplicate(ctx.db, eventId, "linear")) return;

  if (p.type === "AgentSessionEvent") {
    log.info({ action: p.action }, "Received AgentSessionEvent (reserved)");
    return;
  }

  await handleLinearEvent(ctx, {
    type: p.type,
    action: p.action,
    data,
    actor: p.actor,
    url: p.url,
    updatedFrom: p.updatedFrom ?? {},
  });
}
