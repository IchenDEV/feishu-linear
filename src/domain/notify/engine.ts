import { and, eq } from "drizzle-orm";
import type { AppContext } from "../../app/context.js";
import { schema } from "../../db/index.js";
import * as feishu from "../../adapters/feishu/client.js";
import { buildIssueNotifyCard } from "../../cards/issue.js";
import { getMappingByLinearUserId } from "../users/mapping.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("notify");

function shouldNotify(
  config: typeof schema.notificationConfigs.$inferSelect,
  action: string,
): boolean {
  const a = action.toLowerCase();
  if (a.includes("创建") || a === "create") return config.onCreated;
  if (a.includes("更新") || a === "update") return config.onUpdated;
  if (a.includes("完成") || a.includes("done") || a === "complete")
    return config.onCompleted;
  if (a.includes("评论") || a === "comment") return config.onComment;
  return true;
}

export async function sendTeamNotification(
  ctx: AppContext,
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
  const configs = ctx.db
    .select()
    .from(schema.notificationConfigs)
    .where(
      and(
        eq(schema.notificationConfigs.type, "team"),
        eq(schema.notificationConfigs.linearEntityId, opts.teamId),
      ),
    )
    .all();

  const card = buildIssueNotifyCard({
    identifier: opts.issueIdentifier,
    title: opts.issueTitle,
    status: opts.issueStatus,
    url: opts.issueUrl,
    action: opts.action,
    actor: opts.actor,
    detail: opts.detail,
  });

  for (const config of configs) {
    if (!config.feishuChatId || !shouldNotify(config, opts.action)) continue;
    try {
      await feishu.sendCard(ctx.lark, config.feishuChatId, card);
    } catch (err) {
      log.error({ err, chat: config.feishuChatId }, "团队通知失败");
    }
  }
}

export async function sendProjectNotification(
  ctx: AppContext,
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
  const configs = ctx.db
    .select()
    .from(schema.notificationConfigs)
    .where(
      and(
        eq(schema.notificationConfigs.type, "project"),
        eq(schema.notificationConfigs.linearEntityId, opts.projectId),
      ),
    )
    .all();

  const card = buildIssueNotifyCard({
    identifier: "",
    title: opts.title,
    status: opts.status,
    url: opts.url,
    action: `项目${opts.action}`,
    actor: opts.actor,
    detail: opts.detail,
  });

  for (const config of configs) {
    if (!config.feishuChatId || !shouldNotify(config, opts.action)) continue;
    try {
      await feishu.sendCard(ctx.lark, config.feishuChatId, card);
    } catch (err) {
      log.error({ err }, "项目通知失败");
    }
  }

  const channel = ctx.db
    .select()
    .from(schema.projectChannels)
    .where(eq(schema.projectChannels.linearProjectId, opts.projectId))
    .get();

  if (channel) {
    try {
      await feishu.sendCard(ctx.lark, channel.feishuChatId, card);
    } catch (err) {
      log.error({ err }, "项目频道通知失败");
    }
  }
}

export async function sendPersonalNotification(
  ctx: AppContext,
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
  const mapping = getMappingByLinearUserId(ctx, opts.linearUserId);
  if (!mapping) return;

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
    await feishu.sendP2PCard(ctx.lark, mapping.feishuOpenId, card);
  } catch (err) {
    log.error({ err }, "个人通知失败");
  }
}

export async function autoCreateProjectChannel(
  ctx: AppContext,
  opts: {
    linearProjectId: string;
    projectName: string;
    projectUrl: string;
    memberOpenIds?: string[];
  },
) {
  const existing = ctx.db
    .select()
    .from(schema.projectChannels)
    .where(eq(schema.projectChannels.linearProjectId, opts.linearProjectId))
    .get();
  if (existing) return existing;

  try {
    const res = await feishu.createGroup(
      ctx.lark,
      `📋 ${opts.projectName}`,
      `Linear 项目: ${opts.projectName}\n${opts.projectUrl}`,
      opts.memberOpenIds,
    );
    const chatId = (res.data as Record<string, unknown>)?.chat_id as string;
    if (!chatId) throw new Error("无 chat_id");

    const [row] = ctx.db
      .insert(schema.projectChannels)
      .values({
        linearProjectId: opts.linearProjectId,
        linearProjectName: opts.projectName,
        feishuChatId: chatId,
        autoCreated: true,
      })
      .returning()
      .all();

    log.info({ project: opts.linearProjectId, chat: chatId }, "项目频道已创建");
    return row;
  } catch (err) {
    log.error({ err }, "自动创建项目频道失败");
    return null;
  }
}

export async function syncProjectChannelName(
  ctx: AppContext,
  linearProjectId: string,
  newName: string,
) {
  const channel = ctx.db
    .select()
    .from(schema.projectChannels)
    .where(eq(schema.projectChannels.linearProjectId, linearProjectId))
    .get();
  if (!channel) return;

  await feishu.updateGroupName(ctx.lark, channel.feishuChatId, `📋 ${newName}`);
  ctx.db
    .update(schema.projectChannels)
    .set({
      linearProjectName: newName,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.projectChannels.linearProjectId, linearProjectId))
    .run();
}
