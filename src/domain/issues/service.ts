import type { AppContext } from "../../app/context.js";
import * as linearApi from "../../adapters/linear/api.js";
import * as feishu from "../../adapters/feishu/client.js";
import {
  buildIssueCard,
  type IssueCardContext,
  type IssueCardData,
} from "../../cards/issue.js";
import { createSyncThread, findByLinearIssue } from "../sync/threads.js";
import { requireLinearIdentity, getFeishuUserName } from "../users/mapping.js";
import { resolveChatDefaults } from "../settings/store.js";
import {
  uploadAttachmentsToLinear,
  type Attachment,
} from "../messages/content.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("issues");

// ───────────────────────── 署名 ─────────────────────────

/**
 * 以操作者名义写入 Linear。
 * - oauth(actor=app) 模式：用 createAsUser 展示为「飞书用户名（via 飞书）」
 * - api_key 模式：Linear 会署名为 key 所有者，所以在正文里补一行「由谁在飞书发起」
 */
export function attribute(ctx: AppContext, name: string) {
  const oauth = ctx.config.LINEAR_AUTH_MODE === "oauth";
  if (!name) return { createAsUser: undefined, footer: "", prefix: "" };
  return {
    createAsUser: oauth ? name : undefined,
    footer: oauth ? "" : `\n\n---\n_由 ${name} 通过飞书创建_`,
    prefix: oauth ? "" : `**${name}**（来自飞书）：\n\n`,
  };
}

// ───────────────────────── 卡片数据 ─────────────────────────

type IssueLike = Awaited<ReturnType<typeof linearApi.getIssue>>;

export async function toIssueCardData(
  issue: NonNullable<IssueLike>,
  extra: { synced?: boolean } = {},
): Promise<IssueCardData> {
  const [state, assignee, team, project, labels, creator] = await Promise.all([
    issue.state,
    issue.assignee,
    issue.team,
    issue.project,
    issue.labels().then((l) => l.nodes),
    issue.creator,
  ]);
  return {
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? undefined,
    status: state?.name ?? "Unknown",
    statusType: state?.type,
    assignee: assignee?.name,
    priority: issue.priority,
    url: issue.url,
    teamName: team?.name ?? "Unknown",
    projectName: project?.name,
    labels: labels.map((l) => l.name),
    dueDate: issue.dueDate ?? undefined,
    creator: creator?.name,
    createdAt: issue.createdAt.toISOString().split("T")[0],
    synced: extra.synced,
  };
}

export async function issueCard(
  ctx: AppContext,
  issue: NonNullable<IssueLike>,
  c: IssueCardContext = {},
) {
  const synced = Boolean(await findByLinearIssue(ctx, issue.id));
  return buildIssueCard(await toIssueCardData(issue, { synced }), c);
}

function messageIdOf(res: unknown): string | undefined {
  return ((res as { data?: Record<string, unknown> })?.data?.message_id ??
    undefined) as string | undefined;
}

// ───────────────────────── 创建 ─────────────────────────

export interface CreateIssueOpts {
  chatId: string;
  operatorOpenId: string;
  title: string;
  description?: string;
  teamId?: string;
  projectId?: string;
  stateId?: string;
  templateId?: string;
  labelIds?: string[];
  priority?: number;
  /** 负责人：Linear 用户 ID；缺省为操作者本人 */
  assigneeLinearId?: string;
  /** 来源消息（「转为 Issue」/ 同步线程 / 附件） */
  source?: {
    messageId: string;
    threadId?: string;
    attachments?: Attachment[];
    /** 来源消息的纯文本，用于给 Linear 附件命名 */
    excerpt?: string;
  };
  sync?: boolean;
  /** 把结果卡片回复到哪条消息下（缺省直接发到群） */
  replyToMessageId?: string;
  replyInThread?: boolean;
  /** 不发结果卡片（Agent / 表单自己回复） */
  silent?: boolean;
}

export async function createIssueFromFeishu(ctx: AppContext, opts: CreateIssueOpts) {
  const identity = await requireLinearIdentity(ctx, opts.operatorOpenId);
  const operatorName = await getFeishuUserName(ctx, opts.operatorOpenId, identity.linearName ?? "飞书用户");
  const linear = await ctx.getLinear();

  const defaults = await resolveChatDefaults(ctx, opts.chatId);
  const teamId = opts.teamId ?? defaults.teamId ?? (await linearApi.getTeams(linear))[0]?.id;
  if (!teamId) throw new Error("未找到可用的 Linear 团队");

  // 模板：显式 > 群默认 > 团队默认。模板必须属于该团队，否则忽略
  let templateId = opts.templateId ?? defaults.templateId;
  if (templateId) {
    const ok = (await linearApi.listIssueTemplates(linear, teamId, 50)).some(
      (t) => t.id === templateId,
    );
    if (!ok) templateId = undefined;
  }
  if (!templateId) {
    templateId = (await linearApi.getTeamDefaultTemplate(linear, teamId))?.id;
  }

  const who = attribute(ctx, operatorName);
  const attachmentMd = opts.source?.attachments?.length
    ? await uploadAttachmentsToLinear(ctx, opts.source.attachments)
    : [];
  const description =
    [opts.description?.trim(), ...attachmentMd].filter(Boolean).join("\n\n") +
    who.footer;

  const issue = await linearApi.createIssue(linear, {
    teamId,
    title: opts.title.slice(0, 250),
    description: description.trim() || undefined,
    assigneeId: opts.assigneeLinearId ?? identity.linearUserId,
    priority: opts.priority,
    projectId: opts.projectId ?? defaults.projectId,
    stateId: opts.stateId,
    labelIds: opts.labelIds?.length ? opts.labelIds : undefined,
    templateId,
    createAsUser: who.createAsUser,
  });

  // 回链：在 Linear Issue 上挂来源飞书消息 / 会话
  // 菜单 / 私聊入口没有真实群（chatId 不是 oc_ 开头），不挂回链
  const inChat = opts.chatId.startsWith("oc_");
  if (inChat) {
    await attachFeishuBacklink(ctx, issue.id, opts.chatId, opts.source?.messageId, opts.source?.excerpt);
  }

  let synced = false;
  if (opts.sync && opts.source?.messageId) {
    synced = Boolean(
      await upgradeToSyncThread(ctx, {
        issue,
        chatId: opts.chatId,
        messageId: opts.source.messageId,
        threadId: opts.source.threadId,
      }),
    );
  }

  let cardMessageId: string | undefined;
  if (!opts.silent) {
    const card = await issueCard(ctx, issue, {
      chatId: opts.chatId,
      messageId: opts.source?.messageId,
      threadId: opts.source?.threadId,
    });
    const target = opts.replyToMessageId ?? opts.source?.messageId;
    const res = target
      ? await feishu.replyCard(ctx.lark, target, card, opts.replyInThread ?? synced)
      : inChat
        ? await feishu.sendCard(ctx.lark, opts.chatId, card)
        : await feishu.sendP2PCard(ctx.lark, opts.operatorOpenId, card);
    cardMessageId = messageIdOf(res);
  }

  return { issue, synced, cardMessageId };
}

async function attachFeishuBacklink(
  ctx: AppContext,
  issueId: string,
  chatId: string,
  messageId?: string,
  excerpt?: string,
) {
  try {
    const linear = await ctx.getLinear();
    let url = feishu.feishuChatAppLink(chatId);
    if (messageId) url += `&openMessageId=${encodeURIComponent(messageId)}`;
    let chatName = "";
    try {
      chatName = (await feishu.getChatInfo(ctx.lark, chatId)).name ?? "";
    } catch {}
    const title = `飞书${chatName ? ` · ${chatName}` : ""}${excerpt ? `：${excerpt.slice(0, 40)}` : ""}`;
    await linearApi.linkUrlAttachment(linear, issueId, url, title);
  } catch (err) {
    log.warn({ err }, "创建飞书回链失败（非致命）");
  }
}

// ───────────────────────── 关联已有 Issue ─────────────────────────

/** 把一条飞书消息关联到已有 Issue（仅挂回链，不同步；可选升级为同步线程） */
export async function linkExistingIssue(
  ctx: AppContext,
  opts: {
    issueKey: string;
    chatId: string;
    operatorOpenId: string;
    messageId?: string;
    threadId?: string;
    excerpt?: string;
    attachments?: Attachment[];
    sync?: boolean;
    replyInThread?: boolean;
  },
) {
  await requireLinearIdentity(ctx, opts.operatorOpenId);
  const linear = await ctx.getLinear();
  // 允许粘贴链接
  const key =
    opts.issueKey.match(/([A-Za-z][A-Za-z0-9]*-\d+)/)?.[1]?.toUpperCase() ?? opts.issueKey.trim();
  const issue = await linearApi.getIssue(linear, key);
  if (!issue) throw new Error(`未找到 Issue ${opts.issueKey}`);

  await attachFeishuBacklink(ctx, issue.id, opts.chatId, opts.messageId, opts.excerpt);

  // 附件追加为 Issue 评论
  if (opts.attachments?.length) {
    const md = await uploadAttachmentsToLinear(ctx, opts.attachments);
    if (md.length) {
      await linearApi.createComment(linear, {
        issueId: issue.id,
        body: `来自飞书的附件：\n\n${md.join("\n\n")}`,
      });
    }
  }

  let synced = false;
  if (opts.sync && opts.messageId) {
    synced = Boolean(
      await upgradeToSyncThread(ctx, {
        issue,
        chatId: opts.chatId,
        messageId: opts.messageId,
        threadId: opts.threadId,
      }),
    );
  }

  const card = await issueCard(ctx, issue, {
    chatId: opts.chatId,
    messageId: opts.messageId,
    threadId: opts.threadId,
  });
  const res = opts.messageId
    ? await feishu.replyCard(ctx.lark, opts.messageId, card, opts.replyInThread ?? synced)
    : await feishu.sendCard(ctx.lark, opts.chatId, card);
  return { issue, synced, cardMessageId: messageIdOf(res) };
}

// ───────────────────────── 同步线程 ─────────────────────────

/**
 * 把一条消息所在的话题与 Issue 建立双向同步。
 * 话题还不存在时，以话题形式回复根消息来创建。
 */
export async function upgradeToSyncThread(
  ctx: AppContext,
  opts: {
    issue: NonNullable<IssueLike>;
    chatId: string;
    messageId: string;
    threadId?: string;
  },
) {
  try {
    const notice = `🔗 已与 Linear ${opts.issue.identifier} 建立同步：此话题里的回复会同步为 Issue 评论（含图片/文件），Issue 的评论与状态变更也会同步到这里。`;
    const res = await feishu.replyText(ctx.lark, opts.messageId, notice, true);
    const data = (res as { data?: Record<string, unknown> }).data ?? {};
    const threadId = (data.thread_id as string | undefined) ?? opts.threadId;
    const rootMsgId = (data.root_id as string | undefined) ?? opts.messageId;
    if (!threadId) {
      log.warn({ data }, "回复未返回 thread_id，无法建立同步");
      return null;
    }
    return await createSyncThread(ctx, {
      feishuChatId: opts.chatId,
      feishuThreadId: threadId,
      feishuRootMsgId: rootMsgId,
      linearIssueId: opts.issue.id,
      linearIssueIdentifier: opts.issue.identifier,
      linearIssueUrl: opts.issue.url,
    });
  } catch (err) {
    log.warn({ err }, "建立同步线程失败");
    return null;
  }
}

// ───────────────────────── 操作 ─────────────────────────

export interface OpResult {
  success: boolean;
  message: string;
}

export async function assignIssueToLinearUser(
  ctx: AppContext,
  opts: { issueKey: string; operatorOpenId: string; assigneeLinearId?: string },
): Promise<OpResult> {
  const identity = await requireLinearIdentity(ctx, opts.operatorOpenId);
  const linear = await ctx.getLinear();
  const issue = await linearApi.getIssue(linear, opts.issueKey);
  if (!issue) return { success: false, message: `未找到 Issue ${opts.issueKey}` };
  const assigneeId = opts.assigneeLinearId ?? identity.linearUserId;
  await linearApi.updateIssue(linear, issue.id, { assigneeId });
  return {
    success: true,
    message: opts.assigneeLinearId
      ? `已更新 ${issue.identifier} 的负责人`
      : `已将 ${issue.identifier} 分配给你`,
  };
}

/** @deprecated 兼容旧调用 */
export async function assignIssueToFeishuUser(
  ctx: AppContext,
  issueKey: string,
  operatorOpenId: string,
): Promise<OpResult> {
  return assignIssueToLinearUser(ctx, { issueKey, operatorOpenId });
}

export async function setIssueSubscription(
  ctx: AppContext,
  opts: { issueKey: string; operatorOpenId: string; subscribe: boolean },
): Promise<OpResult> {
  await requireLinearIdentity(ctx, opts.operatorOpenId);
  const linear = await ctx.getLinear();
  const issue = await linearApi.getIssue(linear, opts.issueKey);
  if (!issue) return { success: false, message: `未找到 Issue ${opts.issueKey}` };
  // 订阅的是 Linear 用户本人。API key 模式下 subscribe 针对 key 所有者，故用 subscriberIds 指定
  const identity = await requireLinearIdentity(ctx, opts.operatorOpenId);
  const current = (await issue.subscribers()).nodes.map((u) => u.id);
  const set = new Set(current);
  if (opts.subscribe) set.add(identity.linearUserId);
  else set.delete(identity.linearUserId);
  await linear.updateIssue(issue.id, { subscriberIds: [...set] });
  return {
    success: true,
    message: opts.subscribe ? `已订阅 ${issue.identifier}` : `已取消订阅 ${issue.identifier}`,
  };
}

export async function commentOnIssue(
  ctx: AppContext,
  opts: {
    issueKey: string;
    operatorOpenId: string;
    body: string;
    attachments?: Attachment[];
  },
): Promise<OpResult> {
  const identity = await requireLinearIdentity(ctx, opts.operatorOpenId);
  const name = await getFeishuUserName(ctx, opts.operatorOpenId, identity.linearName ?? "飞书用户");
  const linear = await ctx.getLinear();
  const issue = await linearApi.getIssue(linear, opts.issueKey);
  if (!issue) return { success: false, message: `未找到 Issue ${opts.issueKey}` };
  const who = attribute(ctx, name);
  const att = opts.attachments?.length
    ? await uploadAttachmentsToLinear(ctx, opts.attachments)
    : [];
  await linearApi.createComment(linear, {
    issueId: issue.id,
    body: who.prefix + [opts.body, ...att].filter(Boolean).join("\n\n"),
    createAsUser: who.createAsUser,
  });
  return { success: true, message: `已评论 ${issue.identifier}` };
}
