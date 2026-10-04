import { eq } from "drizzle-orm";
import type { AppContext } from "../../app/context.js";
import { schema } from "../../db/index.js";
import * as feishu from "../../adapters/feishu/client.js";
import * as linearApi from "../../adapters/linear/api.js";
import { buildSettingsCard } from "../../cards/settings.js";
import { isLinearAdmin } from "../users/mapping.js";
import {
  SETTING_AUTO_PROJECT_CHANNELS,
  SETTING_PROJECT_CHANNEL_PRIVATE,
  SETTING_WORKSPACE_GUIDANCE,
  getChatGuidance,
  getChatSettings,
  getSetting,
  setSetting,
  upsertChatSettings,
} from "./store.js";
import {
  addSubscription,
  listChatSubscriptions,
  removeSubscription,
  type EntityType,
} from "../notify/engine.js";

export async function permissions(ctx: AppContext, chatId: string, openId: string) {
  const [chatManager, linearAdmin] = await Promise.all([
    feishu.isChatManager(ctx.lark, chatId, openId),
    isLinearAdmin(ctx, openId),
  ]);
  return { chatManager, linearAdmin, canConfigure: chatManager || linearAdmin };
}

export class ForbiddenError extends Error {
  constructor() {
    super("仅群主 / 群管理员 / Linear 管理员可以修改此设置");
    this.name = "ForbiddenError";
  }
}

export async function requireConfigurer(ctx: AppContext, chatId: string, openId: string) {
  const p = await permissions(ctx, chatId, openId);
  if (!p.canConfigure) throw new ForbiddenError();
  return p;
}

// ───────────────────────── Asks ─────────────────────────

const asksKey = (chatId: string) => `asks.chat.${chatId}`;

export async function getAsks(ctx: AppContext, chatId: string) {
  return getSetting<{ teamId: string; templateId?: string }>(ctx, asksKey(chatId));
}

// ───────────────────────── 设置卡片 ─────────────────────────

export async function buildSettingsForChat(ctx: AppContext, chatId: string, openId: string) {
  const linear = await ctx.getLinear();
  const perms = await permissions(ctx, chatId, openId);
  const [teams, projects, settings, guidance, subs, asks, chat] = await Promise.all([
    linearApi.getTeams(linear),
    linearApi.getProjects(linear, 100),
    getChatSettings(ctx, chatId),
    getChatGuidance(ctx, chatId),
    listChatSubscriptions(ctx, chatId),
    getAsks(ctx, chatId),
    feishu.getChatInfo(ctx.lark, chatId).catch(() => ({ name: undefined }) as feishu.ChatInfo),
  ]);
  const templateTeam = settings?.defaultTeamId ?? teams[0]?.id;
  const templates = templateTeam
    ? await linearApi.listIssueTemplates(linear, templateTeam, 10)
    : [];

  const trig = (c: typeof schema.notificationConfigs.$inferSelect) =>
    [
      c.onCreated && "新建",
      c.onUpdated && "更新",
      c.onCompleted && "完成",
      c.onComment && "评论",
    ]
      .filter(Boolean)
      .join("/");

  return buildSettingsCard({
    chatId,
    chatName: chat.name,
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
    templates: templates.map((t) => ({ id: t.id, name: t.name })),
    defaults: {
      teamId: settings?.defaultTeamId ?? guidance?.defaultTeamId ?? undefined,
      projectId: settings?.defaultProjectId ?? guidance?.defaultProjectId ?? undefined,
      templateId: settings?.defaultTemplateId ?? undefined,
    },
    guidance: guidance?.guidance,
    subscriptions: [
      ...subs.configs.map((c) => ({
        kind: "config" as const,
        id: c.id,
        type: c.type,
        name: c.linearEntityName ?? c.linearEntityId,
        triggers: trig(c),
      })),
      ...subs.views.map((v) => ({
        kind: "view" as const,
        id: v.id,
        type: "view",
        name: v.linearViewName ?? v.linearViewId,
        triggers: v.trigger === "both" ? "新进入/完成" : v.trigger === "added" ? "新进入" : "完成",
      })),
    ],
    asks: asks
      ? { teamId: asks.teamId, teamName: teams.find((t) => t.id === asks.teamId)?.name ?? asks.teamId }
      : undefined,
    workspace: perms.linearAdmin
      ? {
          guidance: await getSetting<string>(ctx, SETTING_WORKSPACE_GUIDANCE),
          autoProjectChannels: Boolean(await getSetting<boolean>(ctx, SETTING_AUTO_PROJECT_CHANNELS)),
          privateProjectChannels: Boolean(await getSetting<boolean>(ctx, SETTING_PROJECT_CHANNEL_PRIVATE)),
        }
      : undefined,
  });
}

// ───────────────────────── 写操作 ─────────────────────────

export async function saveChatDefaults(
  ctx: AppContext,
  chatId: string,
  openId: string,
  v: { teamId?: string; projectId?: string; templateId?: string },
) {
  await requireConfigurer(ctx, chatId, openId);
  await upsertChatSettings(ctx, chatId, {
    defaultTeamId: v.teamId || null,
    defaultProjectId: v.projectId || null,
    defaultTemplateId: v.templateId || null,
  });
}

export async function clearChatDefaults(ctx: AppContext, chatId: string, openId: string) {
  await requireConfigurer(ctx, chatId, openId);
  await upsertChatSettings(ctx, chatId, {
    defaultTeamId: null,
    defaultProjectId: null,
    defaultTemplateId: null,
  });
}

export async function saveGuidance(
  ctx: AppContext,
  chatId: string,
  openId: string,
  scope: "chat" | "workspace",
  text: string,
) {
  const perms = await requireConfigurer(ctx, chatId, openId);
  if (scope === "workspace") {
    if (!perms.linearAdmin) throw new ForbiddenError();
    await setSetting(ctx, SETTING_WORKSPACE_GUIDANCE, text);
    return;
  }
  if (!text.trim()) {
    await ctx.db.delete(schema.agentGuidance).where(eq(schema.agentGuidance.feishuChatId, chatId));
    return;
  }
  await ctx.db
    .insert(schema.agentGuidance)
    .values({ feishuChatId: chatId, guidance: text })
    .onConflictDoUpdate({
      target: schema.agentGuidance.feishuChatId,
      set: { guidance: text },
    });
}

/** 按名称解析订阅对象 */
export async function resolveEntity(ctx: AppContext, type: EntityType, name: string) {
  const linear = await ctx.getLinear();
  const n = name.trim().toLowerCase();
  const pick = <T extends { name: string }>(items: T[], extra?: (x: T) => string | undefined) =>
    items.find((x) => x.name.toLowerCase() === n || extra?.(x)?.toLowerCase() === n) ??
    items.find((x) => x.name.toLowerCase().includes(n));
  switch (type) {
    case "team": {
      const t = pick(await linearApi.getTeams(linear), (x) => (x as { key?: string }).key);
      return t && { id: t.id, name: t.name };
    }
    case "project": {
      const p = pick(await linearApi.getProjects(linear, 100));
      return p && { id: p.id, name: p.name };
    }
    case "initiative": {
      const i = pick(await linearApi.getInitiatives(linear));
      return i && { id: i.id, name: i.name };
    }
    case "view": {
      const v = pick(await linearApi.listCustomViews(linear));
      return v && { id: v.id, name: v.name };
    }
  }
}

export async function addSub(
  ctx: AppContext,
  chatId: string,
  openId: string,
  v: { type: EntityType; name: string; triggers: string[] },
) {
  await requireConfigurer(ctx, chatId, openId);
  const ent = await resolveEntity(ctx, v.type, v.name);
  if (!ent) throw new Error(`没有找到名为「${v.name}」的${v.type}`);
  const t = new Set(v.triggers);
  if (v.type === "view") {
    const added = t.has("created") || !t.size;
    const done = t.has("completed");
    await addSubscription(ctx, {
      chatId,
      type: "view",
      entityId: ent.id,
      entityName: ent.name,
      createdBy: openId,
      viewTrigger: added && done ? "both" : done ? "completed" : "added",
    });
  } else {
    const all = !t.size;
    await addSubscription(ctx, {
      chatId,
      type: v.type,
      entityId: ent.id,
      entityName: ent.name,
      createdBy: openId,
      onCreated: all || t.has("created"),
      onUpdated: all || t.has("updated"),
      onCompleted: all || t.has("completed"),
      onComment: all || t.has("comment"),
    });
  }
  return ent;
}

export async function removeSub(
  ctx: AppContext,
  chatId: string,
  openId: string,
  kind: "config" | "view",
  id: number,
) {
  await requireConfigurer(ctx, chatId, openId);
  await removeSubscription(ctx, chatId, kind, id);
}

export async function setAsks(
  ctx: AppContext,
  chatId: string,
  openId: string,
  teamId: string | null,
) {
  await requireConfigurer(ctx, chatId, openId);
  if (teamId) await setSetting(ctx, asksKey(chatId), { teamId });
  else await ctx.db.delete(schema.appSettings).where(eq(schema.appSettings.key, asksKey(chatId)));
}

export async function toggleWorkspaceFlag(
  ctx: AppContext,
  chatId: string,
  openId: string,
  key: typeof SETTING_AUTO_PROJECT_CHANNELS | typeof SETTING_PROJECT_CHANNEL_PRIVATE,
) {
  const perms = await requireConfigurer(ctx, chatId, openId);
  if (!perms.linearAdmin) throw new ForbiddenError();
  const cur = Boolean(await getSetting<boolean>(ctx, key));
  await setSetting(ctx, key, !cur);
  return !cur;
}
