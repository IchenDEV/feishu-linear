import type { Context, Next } from "koa";
import {
  LinearWebhookClient,
  LINEAR_WEBHOOK_SIGNATURE_HEADER,
  type LinearWebhookPayload,
} from "@linear/sdk/webhooks";
import type { AppContext } from "../../app/context.js";
import { isDuplicate } from "../../utils/dedup.js";
import { runInBackground } from "../../utils/background.js";
import {
  notifyStatusChange,
  syncLinearCommentToFeishu,
} from "../../domain/sync/threads.js";
import {
  autoCreateProjectChannel,
  sendPersonalNotification,
  sendProjectNotification,
  sendTeamNotification,
  syncProjectChannelName,
} from "../../domain/notify/engine.js";
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
      log.warn("未配置 LINEAR_WEBHOOK_SECRET，跳过验签（仅开发环境）");
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
      log.warn({ err }, "Linear webhook 验签失败");
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
  const type = p.type;
  const action = p.action;
  const data = p.data ?? {};
  const actor = p.actor;
  const url = p.url;
  const updatedFrom = p.updatedFrom ?? {};
  const createdAt =
    p.createdAt instanceof Date
      ? p.createdAt.toISOString()
      : (p.createdAt ?? "");

  // 防回声：忽略 App 自身触发的事件
  const appUserId = await ctx.getLinearAppUserId();
  if (appUserId && actor?.id === appUserId) {
    log.debug({ type, action }, "跳过自身事件");
    return;
  }

  const eventId = `linear:${type}:${action}:${data.id}:${createdAt}`;
  if (await isDuplicate(ctx.db, eventId, "linear")) return;

  switch (type) {
    case "Issue":
      await handleIssue(ctx, {
        action: action ?? "",
        data,
        actorName: actor?.name ?? "Unknown",
        url,
        updatedFrom,
      });
      break;
    case "Comment":
      await handleComment(ctx, {
        action: action ?? "",
        data,
        actorName: actor?.name ?? "Unknown",
      });
      break;
    case "Project":
      await handleProject(ctx, {
        action: action ?? "",
        data,
        actorName: actor?.name ?? "Unknown",
        url,
        updatedFrom,
      });
      break;
    case "AgentSessionEvent":
      log.info({ action, data }, "收到 AgentSessionEvent（预留）");
      break;
    default:
      log.debug({ type, action }, "未处理的 Linear 事件");
  }
}

async function handleIssue(
  ctx: AppContext,
  opts: {
    action: string;
    data: Record<string, unknown>;
    actorName: string;
    url?: string;
    updatedFrom: Record<string, unknown>;
  },
) {
  const issueId = opts.data.id as string;
  const teamId = opts.data.teamId as string;
  const identifier = opts.data.identifier as string;
  const title = opts.data.title as string;
  const state = opts.data.state as Record<string, unknown> | undefined;
  const assignee = opts.data.assignee as Record<string, unknown> | undefined;

  if (opts.action === "create") {
    await sendTeamNotification(ctx, {
      teamId,
      action: "创建",
      issueIdentifier: identifier,
      issueTitle: title,
      issueStatus: (state?.name as string) ?? "Unknown",
      issueUrl: opts.url ?? "",
      actor: opts.actorName,
    });

    if (opts.data.projectId) {
      await sendProjectNotification(ctx, {
        projectId: opts.data.projectId as string,
        action: "新 Issue",
        title: `${identifier} ${title}`,
        status: (state?.name as string) ?? "Unknown",
        url: opts.url ?? "",
        actor: opts.actorName,
      });
    }

    if (assignee?.id) {
      await sendPersonalNotification(ctx, {
        linearUserId: assignee.id as string,
        action: "你被分配了 Issue",
        issueIdentifier: identifier,
        issueTitle: title,
        issueStatus: (state?.name as string) ?? "Unknown",
        issueUrl: opts.url ?? "",
        actor: opts.actorName,
      });
    }
    return;
  }

  if (opts.action === "update") {
    if (opts.updatedFrom.stateId) {
      const statusName = (state?.name as string) ?? "Unknown";
      await notifyStatusChange(ctx, {
        linearIssueId: issueId,
        status: statusName,
        actor: opts.actorName,
      });
      await sendTeamNotification(ctx, {
        teamId,
        action: "状态变更",
        issueIdentifier: identifier,
        issueTitle: title,
        issueStatus: statusName,
        issueUrl: opts.url ?? "",
        actor: opts.actorName,
        detail: `状态变更为 **${statusName}**`,
      });
    }

    if (opts.updatedFrom.assigneeId && assignee?.id) {
      await sendPersonalNotification(ctx, {
        linearUserId: assignee.id as string,
        action: "Issue 被分配给你",
        issueIdentifier: identifier,
        issueTitle: title,
        issueStatus: (state?.name as string) ?? "Unknown",
        issueUrl: opts.url ?? "",
        actor: opts.actorName,
      });
    }
  }
}

async function handleComment(
  ctx: AppContext,
  opts: {
    action: string;
    data: Record<string, unknown>;
    actorName: string;
  },
) {
  if (opts.action !== "create") return;
  await syncLinearCommentToFeishu(ctx, {
    linearIssueId: opts.data.issueId as string,
    linearCommentId: opts.data.id as string,
    actorName: opts.actorName,
    body: (opts.data.body as string) ?? "",
  });
}

async function handleProject(
  ctx: AppContext,
  opts: {
    action: string;
    data: Record<string, unknown>;
    actorName: string;
    url?: string;
    updatedFrom: Record<string, unknown>;
  },
) {
  const projectId = opts.data.id as string;
  const projectName = opts.data.name as string;

  if (opts.action === "create") {
    await autoCreateProjectChannel(ctx, {
      linearProjectId: projectId,
      projectName,
      projectUrl: opts.url ?? "",
    });
    await sendProjectNotification(ctx, {
      projectId,
      action: "创建",
      title: projectName,
      status: String(opts.data.state ?? "planned"),
      url: opts.url ?? "",
      actor: opts.actorName,
    });
    return;
  }

  if (opts.action === "update") {
    if (opts.updatedFrom.name) {
      await syncProjectChannelName(ctx, projectId, projectName);
    }
    await sendProjectNotification(ctx, {
      projectId,
      action: "更新",
      title: projectName,
      status: String(opts.data.state ?? ""),
      url: opts.url ?? "",
      actor: opts.actorName,
    });
  }
}
