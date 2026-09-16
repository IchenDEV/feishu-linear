import type { Context } from "koa";
import "../types.js";
import type { Client as LarkClient } from "@larksuiteoapi/node-sdk";
import type { LinearClient } from "@linear/sdk";
import type { Db } from "../db/index.js";
import type { Env } from "../config.js";
import type { LinearWebhookPayload } from "./webhook.js";
import { isEchoEvent } from "./webhook.js";
import { isDuplicate } from "../utils/dedup.js";
import {
  syncLinearToFeishu,
  notifySyncThreadStatusChange,
} from "../sync/thread-sync.js";
import {
  sendTeamNotification,
  sendProjectNotification,
  sendPersonalNotification,
  autoCreateProjectChannel,
  syncProjectChannelName,
} from "../notify/engine.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("linear-event");

export function createLinearEventHandler(
  config: Env,
  db: Db,
  lark: LarkClient,
  linear: LinearClient,
) {
  return async (ctx: Context) => {
    ctx.status = 200;
    ctx.body = { success: true };

    const payload = ctx.request.body as LinearWebhookPayload;

    if (isEchoEvent(payload, config.LINEAR_ORG_ID)) {
      log.debug("跳过自身触发的事件");
      return;
    }

    const eventId = `linear:${payload.type}:${payload.action}:${payload.data?.id}:${payload.createdAt}`;
    if (isDuplicate(db, eventId, "linear")) {
      log.debug({ eventId }, "重复事件，跳过");
      return;
    }

    // 异步处理
    setImmediate(async () => {
      try {
        switch (payload.type) {
          case "Issue":
            await handleIssueEvent(config, db, lark, linear, payload);
            break;
          case "Comment":
            await handleCommentEvent(config, db, lark, linear, payload);
            break;
          case "Project":
            await handleProjectEvent(config, db, lark, linear, payload);
            break;
          default:
            log.debug({ type: payload.type, action: payload.action }, "未处理的事件类型");
        }
      } catch (err) {
        log.error({ err, type: payload.type, action: payload.action }, "Linear 事件处理失败");
      }
    });
  };
}

async function handleIssueEvent(
  config: Env,
  db: Db,
  lark: LarkClient,
  _linear: LinearClient,
  payload: LinearWebhookPayload,
) {
  const data = payload.data;
  const issueId = data.id as string;
  const teamId = data.teamId as string;
  const identifier = data.identifier as string;
  const title = data.title as string;
  const url = payload.url;
  const actorName = payload.actor?.name ?? "Unknown";

  switch (payload.action) {
    case "create": {
      const state = data.state as Record<string, unknown> | undefined;
      const assignee = data.assignee as Record<string, unknown> | undefined;

      await sendTeamNotification(db, lark, {
        teamId,
        action: "创建",
        issueIdentifier: identifier,
        issueTitle: title,
        issueStatus: (state?.name as string) ?? "Unknown",
        issueUrl: url ?? "",
        actor: actorName,
      });

      if (data.projectId) {
        await sendProjectNotification(db, lark, {
          projectId: data.projectId as string,
          action: "新 Issue",
          title: `${identifier} ${title}`,
          status: (state?.name as string) ?? "Unknown",
          url: url ?? "",
          actor: actorName,
        });
      }

      if (assignee?.id) {
        await sendPersonalNotification(db, lark, {
          linearUserId: assignee.id as string,
          action: "你被分配了 Issue",
          issueIdentifier: identifier,
          issueTitle: title,
          issueStatus: (state?.name as string) ?? "Unknown",
          issueUrl: url ?? "",
          actor: actorName,
        });
      }
      break;
    }

    case "update": {
      const updatedFrom = payload.updatedFrom ?? {};
      const state = data.state as Record<string, unknown> | undefined;

      if (updatedFrom.stateId) {
        const statusName = (state?.name as string) ?? "Unknown";

        await notifySyncThreadStatusChange(db, lark, {
          linearIssueId: issueId,
          status: statusName,
          actor: actorName,
        });

        await sendTeamNotification(db, lark, {
          teamId,
          action: "状态变更",
          issueIdentifier: identifier,
          issueTitle: title,
          issueStatus: statusName,
          issueUrl: url ?? "",
          actor: actorName,
          detail: `状态变更为 **${statusName}**`,
        });
      }

      if (updatedFrom.assigneeId) {
        const assignee = data.assignee as Record<string, unknown> | undefined;
        if (assignee?.id) {
          await sendPersonalNotification(db, lark, {
            linearUserId: assignee.id as string,
            action: "Issue 被分配给你",
            issueIdentifier: identifier,
            issueTitle: title,
            issueStatus: (state?.name as string) ?? "Unknown",
            issueUrl: url ?? "",
            actor: actorName,
          });
        }
      }
      break;
    }

    case "remove": {
      log.info({ identifier }, "Issue 已删除");
      break;
    }
  }
}

async function handleCommentEvent(
  _config: Env,
  db: Db,
  lark: LarkClient,
  _linear: LinearClient,
  payload: LinearWebhookPayload,
) {
  if (payload.action !== "create") return;

  const data = payload.data;
  await syncLinearToFeishu(db, lark, {
    linearIssueId: data.issueId as string,
    linearCommentId: data.id as string,
    actorName: payload.actor?.name ?? "Unknown",
    body: data.body as string,
  });
}

async function handleProjectEvent(
  _config: Env,
  db: Db,
  lark: LarkClient,
  _linear: LinearClient,
  payload: LinearWebhookPayload,
) {
  const data = payload.data;
  const projectId = data.id as string;
  const projectName = data.name as string;
  const actorName = payload.actor?.name ?? "Unknown";

  switch (payload.action) {
    case "create": {
      await autoCreateProjectChannel(db, lark, {
        linearProjectId: projectId,
        projectName,
        projectUrl: payload.url ?? "",
      });

      await sendProjectNotification(db, lark, {
        projectId,
        action: "创建",
        title: projectName,
        status: (data.state as string) ?? "planned",
        url: payload.url ?? "",
        actor: actorName,
      });
      break;
    }

    case "update": {
      const updatedFrom = payload.updatedFrom ?? {};

      if (updatedFrom.name) {
        await syncProjectChannelName(db, lark, projectId, projectName);
      }

      await sendProjectNotification(db, lark, {
        projectId,
        action: "更新",
        title: projectName,
        status: (data.state as string) ?? "",
        url: payload.url ?? "",
        actor: actorName,
      });
      break;
    }
  }
}
