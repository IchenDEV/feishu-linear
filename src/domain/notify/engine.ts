import { and, eq } from "drizzle-orm";
import type { AppContext } from "../../app/context.js";
import { schema } from "../../db/index.js";
import * as feishu from "../../adapters/feishu/client.js";
import * as linearApi from "../../adapters/linear/api.js";
import { buildIssueNotifyCard, buildProjectCard } from "../../cards/issue.js";
import { button, type CardElement } from "../../cards/kit.js";
import {
  feishuOpenIdsForLinearUsers,
  getMappingByLinearUserId,
} from "../users/mapping.js";
import {
  SETTING_AUTO_PROJECT_CHANNELS,
  SETTING_PROJECT_CHANNEL_PRIVATE,
  getSetting,
} from "../settings/store.js";
import { lazy, t, type LazyText } from "../../i18n/index.js";
import { runLocalized } from "../../i18n/resolve.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("notify");

export type Trigger = "created" | "updated" | "completed" | "comment";

type Config = typeof schema.notificationConfigs.$inferSelect;
export type EntityType = "team" | "project" | "initiative" | "view";

function allowed(config: Config, trigger: Trigger): boolean {
  switch (trigger) {
    case "created":
      return config.onCreated;
    case "updated":
      return config.onUpdated;
    case "completed":
      return config.onCompleted;
    case "comment":
      return config.onComment;
  }
}

async function configsFor(ctx: AppContext, type: EntityType, entityId: string) {
  return ctx.db
    .select()
    .from(schema.notificationConfigs)
    .where(
      and(
        eq(schema.notificationConfigs.type, type),
        eq(schema.notificationConfigs.linearEntityId, entityId),
      ),
    );
}

/** 发给订阅了该实体的所有群；`projectChannel` 为项目专属频道（总是接收） */
async function fanOut(
  ctx: AppContext,
  type: EntityType,
  entityId: string,
  trigger: Trigger,
  makeCard: () => Record<string, unknown>,
  opts: { projectChannel?: boolean } = {},
) {
  const chats = new Set<string>();
  for (const c of await configsFor(ctx, type, entityId)) {
    if (c.feishuChatId && allowed(c, trigger)) chats.add(c.feishuChatId);
  }
  if (opts.projectChannel) {
    const [ch] = await ctx.db
      .select()
      .from(schema.projectChannels)
      .where(eq(schema.projectChannels.linearProjectId, entityId))
      .limit(1);
    if (ch) chats.add(ch.feishuChatId);
  }
  await Promise.all(
    [...chats].map(async (chatId) => {
      try {
        // 每个群按自己的语言生成卡片
        await runLocalized(ctx, { chatId }, () => feishu.sendCard(ctx.lark, chatId, makeCard()));
      } catch (err) {
        log.error({ err, chatId, type, entityId }, "Failed to send the channel notification");
      }
    }),
  );
}

// ───────────────────────── Issue 事件 → 团队 / 项目 / 个人 ─────────────────────────

export interface IssueEvent {
  trigger: Trigger;
  action: LazyText;
  issueId: string;
  identifier: string;
  title: string;
  status?: string;
  statusType?: string;
  assignee?: string;
  url: string;
  actor: string;
  actorId?: string;
  teamId?: string;
  projectId?: string;
  detail?: LazyText;
}

function issueActions(identifier: string): CardElement[] {
  return [
    button({ text: t("btn.assignToMe"), value: { action: "assign_to_me", issueId: identifier } }),
    button({ text: t("btn.subscribe"), value: { action: "subscribe_issue", issueId: identifier } }),
  ];
}

export async function notifyIssueToChats(ctx: AppContext, e: IssueEvent) {
  const card = () =>
    buildIssueNotifyCard({
      identifier: e.identifier,
      title: e.title,
      status: e.status,
      statusType: e.statusType,
      url: e.url,
      action: lazy(e.action) ?? "",
      actor: e.actor,
      assignee: e.assignee,
      detail: lazy(e.detail),
      extraButtons: e.trigger === "created" ? issueActions(e.identifier) : [],
    });
  const jobs: Promise<unknown>[] = [];
  if (e.teamId) jobs.push(fanOut(ctx, "team", e.teamId, e.trigger, card));
  if (e.projectId) {
    jobs.push(fanOut(ctx, "project", e.projectId, e.trigger, card, { projectChannel: true }));
  }
  await Promise.all(jobs);
}

// ───────────────────────── 个人通知 ─────────────────────────

export type PersonalKind = "assigned" | "mentioned" | "comment" | "status";

const PREF_FIELD: Record<PersonalKind, keyof typeof schema.userNotificationPrefs.$inferSelect> = {
  assigned: "onAssigned",
  mentioned: "onMentioned",
  comment: "onComment",
  status: "onStatusChange",
};

export async function getPrefs(ctx: AppContext, openId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.userNotificationPrefs)
    .where(eq(schema.userNotificationPrefs.feishuOpenId, openId))
    .limit(1);
  return (
    row ?? {
      feishuOpenId: openId,
      enabled: true,
      onAssigned: true,
      onMentioned: true,
      onComment: true,
      onStatusChange: true,
    }
  );
}

export async function setPrefs(
  ctx: AppContext,
  openId: string,
  patch: Partial<{
    enabled: boolean;
    onAssigned: boolean;
    onMentioned: boolean;
    onComment: boolean;
    onStatusChange: boolean;
  }>,
) {
  await ctx.db
    .insert(schema.userNotificationPrefs)
    .values({ feishuOpenId: openId, ...patch })
    .onConflictDoUpdate({
      target: schema.userNotificationPrefs.feishuOpenId,
      set: patch,
    });
}

/** 按偏好给一组 Linear 用户发私聊；`excludeLinearUserId` 通常是操作者本人 */
export async function notifyPersonal(
  ctx: AppContext,
  opts: {
    linearUserIds: string[];
    kind: PersonalKind;
    excludeLinearUserId?: string;
    event: Omit<IssueEvent, "trigger" | "teamId" | "projectId" | "issueId">;
  },
) {
  const ids = [...new Set(opts.linearUserIds)].filter(
    (id) => id && id !== opts.excludeLinearUserId,
  );
  const makeCard = () =>
    buildIssueNotifyCard({
      identifier: opts.event.identifier,
      title: opts.event.title,
      status: opts.event.status,
      statusType: opts.event.statusType,
      url: opts.event.url,
      action: lazy(opts.event.action) ?? "",
      actor: opts.event.actor,
      assignee: opts.event.assignee,
      detail: lazy(opts.event.detail),
      extraButtons: [
        button({
          text: t("btn.comment"),
          value: { action: "prompt_comment", issueId: opts.event.identifier },
        }),
      ],
    });
  for (const id of ids) {
    const mapping = await getMappingByLinearUserId(ctx, id);
    if (!mapping) continue;
    const prefs = await getPrefs(ctx, mapping.feishuOpenId);
    if (!prefs.enabled || !prefs[PREF_FIELD[opts.kind]]) continue;
    try {
      await runLocalized(ctx, { openId: mapping.feishuOpenId }, () =>
        feishu.sendP2PCard(ctx.lark, mapping.feishuOpenId, makeCard()),
      );
    } catch (err) {
      log.error({ err, user: id }, "Failed to send the personal notification");
    }
  }
}

/** Issue 的相关人：负责人 + 创建者 + 订阅者（需要 API 查询） */
export async function issueStakeholders(ctx: AppContext, issueId: string) {
  try {
    const linear = await ctx.getLinear();
    const issue = await linearApi.getIssue(linear, issueId);
    if (!issue) return [];
    const [assignee, creator, subs] = await Promise.all([
      issue.assignee,
      issue.creator,
      issue.subscribers().then((s) => s.nodes),
    ]);
    return [assignee?.id, creator?.id, ...subs.map((s) => s.id)].filter(
      (x): x is string => Boolean(x),
    );
  } catch (err) {
    log.warn({ err }, "Failed to look up issue stakeholders");
    return [];
  }
}

// ───────────────────────── Project / Initiative ─────────────────────────

export async function notifyProjectEvent(
  ctx: AppContext,
  e: {
    trigger: Trigger;
    projectId: string;
    initiativeIds?: string[];
    action: LazyText;
    name: string;
    status?: string;
    url: string;
    actor: string;
    detail?: LazyText;
  },
) {
  const card = () =>
    buildIssueNotifyCard({
      title: e.name,
      status: e.status,
      url: e.url,
      action: `📁 ${lazy(e.action)}`,
      actor: e.actor,
      detail: lazy(e.detail),
    });
  await Promise.all([
    fanOut(ctx, "project", e.projectId, e.trigger, card, { projectChannel: true }),
    ...(e.initiativeIds ?? []).map((id) =>
      fanOut(ctx, "initiative", id, e.trigger, card),
    ),
  ]);
}

export async function notifyInitiativeEvent(
  ctx: AppContext,
  e: {
    trigger: Trigger;
    initiativeId: string;
    action: LazyText;
    name: string;
    status?: string;
    url: string;
    actor: string;
    detail?: LazyText;
  },
) {
  const card = () =>
    buildIssueNotifyCard({
      title: e.name,
      status: e.status,
      url: e.url,
      action: `🎯 ${lazy(e.action)}`,
      actor: e.actor,
      detail: lazy(e.detail),
    });
  await fanOut(ctx, "initiative", e.initiativeId, e.trigger, card);
}

// ───────────────────────── 订阅管理 ─────────────────────────

export async function listChatSubscriptions(ctx: AppContext, chatId: string) {
  const [configs, views] = await Promise.all([
    ctx.db
      .select()
      .from(schema.notificationConfigs)
      .where(eq(schema.notificationConfigs.feishuChatId, chatId)),
    ctx.db
      .select()
      .from(schema.viewSubscriptions)
      .where(eq(schema.viewSubscriptions.feishuChatId, chatId)),
  ]);
  return { configs, views };
}

export async function addSubscription(
  ctx: AppContext,
  opts: {
    chatId: string;
    type: EntityType;
    entityId: string;
    entityName: string;
    createdBy?: string;
    onCreated?: boolean;
    onUpdated?: boolean;
    onCompleted?: boolean;
    onComment?: boolean;
    viewTrigger?: "added" | "completed" | "both";
  },
) {
  if (opts.type === "view") {
    const [row] = await ctx.db
      .insert(schema.viewSubscriptions)
      .values({
        linearViewId: opts.entityId,
        linearViewName: opts.entityName,
        feishuChatId: opts.chatId,
        trigger: opts.viewTrigger ?? "added",
        createdBy: opts.createdBy,
      })
      .onConflictDoUpdate({
        target: [schema.viewSubscriptions.linearViewId, schema.viewSubscriptions.feishuChatId],
        set: { trigger: opts.viewTrigger ?? "added", linearViewName: opts.entityName },
      })
      .returning();
    return row;
  }
  const existing = (await configsFor(ctx, opts.type, opts.entityId)).find(
    (c) => c.feishuChatId === opts.chatId,
  );
  const flags = {
    onCreated: opts.onCreated ?? true,
    onUpdated: opts.onUpdated ?? true,
    onCompleted: opts.onCompleted ?? true,
    onComment: opts.onComment ?? true,
  };
  if (existing) {
    const [row] = await ctx.db
      .update(schema.notificationConfigs)
      .set({ ...flags, linearEntityName: opts.entityName })
      .where(eq(schema.notificationConfigs.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await ctx.db
    .insert(schema.notificationConfigs)
    .values({
      type: opts.type,
      linearEntityId: opts.entityId,
      linearEntityName: opts.entityName,
      feishuChatId: opts.chatId,
      createdBy: opts.createdBy,
      ...flags,
    })
    .returning();
  return row;
}

export async function removeSubscription(
  ctx: AppContext,
  chatId: string,
  kind: "config" | "view",
  id: number,
) {
  if (kind === "view") {
    await ctx.db
      .delete(schema.viewSubscriptions)
      .where(
        and(
          eq(schema.viewSubscriptions.id, id),
          eq(schema.viewSubscriptions.feishuChatId, chatId),
        ),
      );
  } else {
    await ctx.db
      .delete(schema.notificationConfigs)
      .where(
        and(
          eq(schema.notificationConfigs.id, id),
          eq(schema.notificationConfigs.feishuChatId, chatId),
        ),
      );
  }
}

// ───────────────────────── 项目频道 ─────────────────────────

export async function isAutoProjectChannelEnabled(ctx: AppContext) {
  return Boolean(await getSetting<boolean>(ctx, SETTING_AUTO_PROJECT_CHANNELS));
}

export async function getProjectChannel(ctx: AppContext, linearProjectId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.projectChannels)
    .where(eq(schema.projectChannels.linearProjectId, linearProjectId))
    .limit(1);
  return row;
}

/** 项目成员（含负责人）对应的飞书 open_id */
async function projectMemberOpenIds(ctx: AppContext, projectId: string) {
  try {
    const linear = await ctx.getLinear();
    const project = await linear.project(projectId);
    const lead = await project.lead;
    const members = await linearApi.getProjectMembers(linear, projectId);
    const ids = [lead?.id, ...members.map((m) => m.id)].filter((x): x is string => Boolean(x));
    return feishuOpenIdsForLinearUsers(ctx, ids);
  } catch (err) {
    log.warn({ err }, "Failed to read project members");
    return [];
  }
}

/**
 * 为 Linear 项目建立飞书频道：建群 → 邀请项目成员 → 群内加 Linear 回链标签页 →
 * 发项目简介并置顶。已存在则直接返回。
 */
export async function createProjectChannel(
  ctx: AppContext,
  opts: { projectId: string; autoCreated?: boolean },
) {
  const existing = await getProjectChannel(ctx, opts.projectId);
  if (existing) return existing;

  const linear = await ctx.getLinear();
  const project = await linearApi.getProject(linear, opts.projectId);
  const members = await projectMemberOpenIds(ctx, opts.projectId);
  const lead = await project.lead;

  const res = await feishu.createGroup(
    ctx.lark,
    `📋 ${project.name}`,
    t("channel.description", { name: project.name, url: project.url }),
    members,
    (await getSetting<boolean>(ctx, SETTING_PROJECT_CHANNEL_PRIVATE)) ? "private" : "public",
  );
  const chatId = (res.data as Record<string, unknown>)?.chat_id as string | undefined;
  if (!chatId) throw new Error(t("channel.createFailed"));

  const [row] = await ctx.db
    .insert(schema.projectChannels)
    .values({
      linearProjectId: opts.projectId,
      linearProjectName: project.name,
      feishuChatId: chatId,
      autoCreated: opts.autoCreated ?? true,
    })
    .onConflictDoNothing()
    .returning();

  try {
    await feishu.addChatUrlTab(ctx.lark, chatId, { name: t("channel.tab"), url: project.url });
  } catch (err) {
    log.warn({ err }, "Failed to add the chat tab (requires the im:chat.tabs:write_only scope; non-fatal)");
  }
  try {
    const intro = await feishu.sendCard(
      ctx.lark,
      chatId,
      buildProjectCard({
        name: project.name,
        description: project.description ?? undefined,
        status: String(project.state ?? ""),
        lead: lead?.name,
        targetDate: project.targetDate ?? undefined,
        progress: project.progress,
        url: project.url,
      }),
    );
    const msgId = (intro.data as Record<string, unknown>)?.message_id as string | undefined;
    if (msgId) await feishu.pinMessage(ctx.lark, msgId).catch(() => {});
  } catch (err) {
    log.warn({ err }, "Failed to post the project intro (non-fatal)");
  }

  log.info({ project: opts.projectId, chat: chatId, members: members.length }, "Project channel created");
  return row;
}

export async function syncProjectChannelName(
  ctx: AppContext,
  linearProjectId: string,
  newName: string,
) {
  const channel = await getProjectChannel(ctx, linearProjectId);
  if (!channel) return;
  await feishu.updateGroupName(ctx.lark, channel.feishuChatId, `📋 ${newName}`);
  await ctx.db
    .update(schema.projectChannels)
    .set({ linearProjectName: newName })
    .where(eq(schema.projectChannels.linearProjectId, linearProjectId));
}

/** 项目成员变化后，把新成员拉进频道 */
export async function syncProjectChannelMembers(ctx: AppContext, linearProjectId: string) {
  const channel = await getProjectChannel(ctx, linearProjectId);
  if (!channel) return;
  const members = await projectMemberOpenIds(ctx, linearProjectId);
  if (members.length) {
    await feishu.addChatMembers(ctx.lark, channel.feishuChatId, members).catch((err) => {
      log.warn({ err }, "Failed to add members to the project channel");
    });
  }
}
