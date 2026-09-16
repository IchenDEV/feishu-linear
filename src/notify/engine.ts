import { eq, and } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { schema } from "../db/index.js";
import * as feishuClient from "../feishu/client.js";
import { buildIssueNotifyCard } from "../cards/issue-card.js";
import { createChildLogger } from "../logger.js";
import type { Client as LarkClient } from "@larksuiteoapi/node-sdk";

const log = createChildLogger("notify");

// ── 层级1：团队通知 ──
export async function sendTeamNotification(
  db: Db,
  lark: LarkClient,
  opts: {
    teamId: string;
    action: string;
    issueIdentifier: string;
    issueTitle: string;
    issueStatus: string;
    issueUrl: string;
    actor: string;
    detail?: string;
  },
) {
  const configs = db
    .select()
    .from(schema.notificationConfigs)
    .where(
      and(
        eq(schema.notificationConfigs.type, "team"),
        eq(schema.notificationConfigs.linearEntityId, opts.teamId),
      ),
    )
    .all();

  for (const config of configs) {
    if (!config.feishuChatId) continue;

    const shouldNotify = shouldSendNotification(config, opts.action);
    if (!shouldNotify) continue;

    const card = buildIssueNotifyCard({
      identifier: opts.issueIdentifier,
      title: opts.issueTitle,
      status: opts.issueStatus,
      url: opts.issueUrl,
      action: opts.action,
      actor: opts.actor,
      detail: opts.detail,
    });

    try {
      await feishuClient.sendCardMessage(lark, config.feishuChatId, card);
      log.info(
        { team: opts.teamId, chat: config.feishuChatId, action: opts.action },
        "团队通知已发送",
      );
    } catch (err) {
      log.error({ err, chat: config.feishuChatId }, "团队通知发送失败");
    }
  }
}

// ── 层级2：项目/Initiative 通知 ──
export async function sendProjectNotification(
  db: Db,
  lark: LarkClient,
  opts: {
    projectId: string;
    action: string;
    title: string;
    status: string;
    url: string;
    actor: string;
    detail?: string;
  },
) {
  const configs = db
    .select()
    .from(schema.notificationConfigs)
    .where(
      and(
        eq(schema.notificationConfigs.type, "project"),
        eq(schema.notificationConfigs.linearEntityId, opts.projectId),
      ),
    )
    .all();

  for (const config of configs) {
    if (!config.feishuChatId) continue;

    const shouldNotify = shouldSendNotification(config, opts.action);
    if (!shouldNotify) continue;

    const card = buildIssueNotifyCard({
      identifier: "",
      title: opts.title,
      status: opts.status,
      url: opts.url,
      action: `项目${opts.action}`,
      actor: opts.actor,
      detail: opts.detail,
    });

    try {
      await feishuClient.sendCardMessage(lark, config.feishuChatId, card);
    } catch (err) {
      log.error({ err, chat: config.feishuChatId }, "项目通知发送失败");
    }
  }

  // 同时检查项目频道映射
  const projectChannel = db
    .select()
    .from(schema.projectChannels)
    .where(eq(schema.projectChannels.linearProjectId, opts.projectId))
    .get();

  if (projectChannel) {
    const card = buildIssueNotifyCard({
      identifier: "",
      title: opts.title,
      status: opts.status,
      url: opts.url,
      action: `项目${opts.action}`,
      actor: opts.actor,
      detail: opts.detail,
    });

    try {
      await feishuClient.sendCardMessage(lark, projectChannel.feishuChatId, card);
    } catch (err) {
      log.error({ err }, "项目频道通知发送失败");
    }
  }
}

// ── 层级3：个人通知（通过机器人私聊） ──
export async function sendPersonalNotification(
  db: Db,
  lark: LarkClient,
  opts: {
    linearUserId: string;
    action: string;
    issueIdentifier: string;
    issueTitle: string;
    issueStatus: string;
    issueUrl: string;
    actor: string;
    detail?: string;
  },
) {
  // 查找用户映射获取飞书 open_id
  const userMapping = db
    .select()
    .from(schema.userMappings)
    .where(eq(schema.userMappings.linearUserId, opts.linearUserId))
    .get();

  if (!userMapping) {
    log.debug({ linearUser: opts.linearUserId }, "未找到用户映射，跳过个人通知");
    return;
  }

  const card = buildIssueNotifyCard({
    identifier: opts.issueIdentifier,
    title: opts.issueTitle,
    status: opts.issueStatus,
    url: opts.issueUrl,
    action: opts.action,
    actor: opts.actor,
    detail: opts.detail,
  });

  try {
    await feishuClient.sendP2PCard(lark, userMapping.feishuOpenId, card);
    log.info(
      { user: userMapping.feishuOpenId, action: opts.action },
      "个人通知已发送",
    );
  } catch (err) {
    log.error({ err, user: userMapping.feishuOpenId }, "个人通知发送失败");
  }
}

// ── 层级5：项目频道自动创建 ──
export async function autoCreateProjectChannel(
  db: Db,
  lark: LarkClient,
  opts: {
    linearProjectId: string;
    projectName: string;
    memberOpenIds?: string[];
    projectUrl: string;
  },
) {
  // 检查是否已有映射
  const existing = db
    .select()
    .from(schema.projectChannels)
    .where(eq(schema.projectChannels.linearProjectId, opts.linearProjectId))
    .get();

  if (existing) {
    log.info({ project: opts.linearProjectId }, "项目频道已存在");
    return existing;
  }

  try {
    const groupName = `📋 ${opts.projectName}`;
    const res = await feishuClient.createGroup(
      lark,
      groupName,
      `Linear 项目: ${opts.projectName}\n${opts.projectUrl}`,
      opts.memberOpenIds,
    );

    const chatId = (res.data as Record<string, unknown>)?.chat_id as string;
    if (!chatId) throw new Error("群组创建返回无 chat_id");

    const [record] = db
      .insert(schema.projectChannels)
      .values({
        linearProjectId: opts.linearProjectId,
        linearProjectName: opts.projectName,
        feishuChatId: chatId,
        autoCreated: true,
      })
      .returning()
      .all();

    log.info(
      { project: opts.linearProjectId, chat: chatId },
      "项目频道已自动创建",
    );
    return record;
  } catch (err) {
    log.error({ err, project: opts.linearProjectId }, "自动创建项目频道失败");
    return null;
  }
}

// ── 项目改名自动更新频道名 ──
export async function syncProjectChannelName(
  db: Db,
  lark: LarkClient,
  linearProjectId: string,
  newName: string,
) {
  const channel = db
    .select()
    .from(schema.projectChannels)
    .where(eq(schema.projectChannels.linearProjectId, linearProjectId))
    .get();

  if (!channel) return;

  try {
    await feishuClient.updateGroupName(lark, channel.feishuChatId, `📋 ${newName}`);
    db.update(schema.projectChannels)
      .set({ linearProjectName: newName, updatedAt: new Date().toISOString() })
      .where(eq(schema.projectChannels.linearProjectId, linearProjectId))
      .run();

    log.info({ project: linearProjectId, newName }, "项目频道名称已同步");
  } catch (err) {
    log.error({ err }, "同步项目频道名称失败");
  }
}

// ── 辅助函数 ──

function shouldSendNotification(
  config: typeof schema.notificationConfigs.$inferSelect,
  action: string,
): boolean {
  const actionLower = action.toLowerCase();
  if (actionLower.includes("创建") || actionLower === "create") return config.onCreated;
  if (actionLower.includes("更新") || actionLower === "update") return config.onUpdated;
  if (
    actionLower.includes("完成") ||
    actionLower.includes("done") ||
    actionLower === "complete"
  )
    return config.onCompleted;
  if (actionLower.includes("评论") || actionLower === "comment") return config.onComment;
  return true;
}
