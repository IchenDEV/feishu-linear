import { eq } from "drizzle-orm";
import type { AppContext } from "../../app/context.js";
import { schema } from "../../db/index.js";

// ───────────────────────── 全局 key/value ─────────────────────────

export const SETTING_WORKSPACE_GUIDANCE = "agent.workspace_guidance";
export const SETTING_AUTO_PROJECT_CHANNELS = "project_channels.auto_create";
export const SETTING_PROJECT_CHANNEL_PRIVATE = "project_channels.private";

export async function getSetting<T>(
  ctx: AppContext,
  key: string,
): Promise<T | undefined> {
  const [row] = await ctx.db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, key))
    .limit(1);
  return row?.value as T | undefined;
}

export async function setSetting(ctx: AppContext, key: string, value: unknown) {
  await ctx.db
    .insert(schema.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value },
    });
}

// ───────────────────────── 群级设置 ─────────────────────────

export async function getChatSettings(ctx: AppContext, chatId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.chatSettings)
    .where(eq(schema.chatSettings.feishuChatId, chatId))
    .limit(1);
  return row;
}

export async function upsertChatSettings(
  ctx: AppContext,
  chatId: string,
  patch: {
    defaultTeamId?: string | null;
    defaultProjectId?: string | null;
    defaultTemplateId?: string | null;
  },
) {
  await ctx.db
    .insert(schema.chatSettings)
    .values({ feishuChatId: chatId, ...patch })
    .onConflictDoUpdate({
      target: schema.chatSettings.feishuChatId,
      set: patch,
    });
}

export async function getChatGuidance(ctx: AppContext, chatId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.agentGuidance)
    .where(eq(schema.agentGuidance.feishuChatId, chatId))
    .limit(1);
  return row;
}

/**
 * 群里的默认值（团队 / 项目 / 模板）。项目的优先级：
 * 群设置 → 项目专属群（自动创建的项目频道）→ 旧的 Guidance 默认项目
 */
export async function resolveChatDefaults(ctx: AppContext, chatId: string) {
  const [settings, guidance, channel] = await Promise.all([
    getChatSettings(ctx, chatId),
    getChatGuidance(ctx, chatId),
    ctx.db
      .select()
      .from(schema.projectChannels)
      .where(eq(schema.projectChannels.feishuChatId, chatId))
      .limit(1)
      .then((r) => r[0]),
  ]);
  return {
    teamId: settings?.defaultTeamId ?? guidance?.defaultTeamId ?? undefined,
    projectId:
      settings?.defaultProjectId ??
      channel?.linearProjectId ??
      guidance?.defaultProjectId ??
      undefined,
    templateId: settings?.defaultTemplateId ?? undefined,
  };
}

/** 工作区级 + 群级 Agent Guidance 合并（对标 Slack 里管理员在集成设置写的 guidance） */
export async function buildGuidanceText(
  ctx: AppContext,
  chatId: string,
): Promise<string> {
  const [workspace, chat] = await Promise.all([
    getSetting<string>(ctx, SETTING_WORKSPACE_GUIDANCE),
    getChatGuidance(ctx, chatId),
  ]);
  const parts: string[] = [];
  if (workspace) parts.push(`### Workspace guidance\n${workspace}`);
  if (chat?.guidance) parts.push(`### Channel guidance\n${chat.guidance}`);
  return parts.join("\n\n");
}
