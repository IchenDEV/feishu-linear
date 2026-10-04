import { eq } from "drizzle-orm";
import type { AppContext } from "../app/context.js";
import { schema } from "../db/index.js";
import { getDefaultLocale, normalizeLocale, withLocale, type Locale } from "./index.js";

export const SETTING_WORKSPACE_LOCALE = "workspace.locale";

/**
 * 解析界面语言。优先级：用户个人设置 → 群设置 → 工作区默认（管理员设置）→ 环境变量 DEFAULT_LOCALE。
 * 个人通知、私聊用 openId；群内消息用 chatId；两者都给时，个人设置优先。
 */
export async function resolveLocale(
  ctx: AppContext,
  who: { openId?: string; chatId?: string } = {},
): Promise<Locale> {
  try {
    if (who.openId) {
      const [row] = await ctx.db
        .select({ locale: schema.userNotificationPrefs.locale })
        .from(schema.userNotificationPrefs)
        .where(eq(schema.userNotificationPrefs.feishuOpenId, who.openId))
        .limit(1);
      const l = normalizeLocale(row?.locale);
      if (l) return l;
    }
    if (who.chatId) {
      const [row] = await ctx.db
        .select({ locale: schema.chatSettings.locale })
        .from(schema.chatSettings)
        .where(eq(schema.chatSettings.feishuChatId, who.chatId))
        .limit(1);
      const l = normalizeLocale(row?.locale);
      if (l) return l;
    }
    const [ws] = await ctx.db
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, SETTING_WORKSPACE_LOCALE))
      .limit(1);
    const l = normalizeLocale(ws?.value);
    if (l) return l;
  } catch {
    // 读取失败时回退到默认语言，不影响主流程
  }
  return getDefaultLocale();
}

/** 解析语言并在其下执行 */
export async function runLocalized<T>(
  ctx: AppContext,
  who: { openId?: string; chatId?: string },
  fn: () => Promise<T>,
): Promise<T> {
  const locale = await resolveLocale(ctx, who);
  return withLocale(locale, fn);
}

export async function setUserLocale(ctx: AppContext, openId: string, locale: Locale | null) {
  await ctx.db
    .insert(schema.userNotificationPrefs)
    .values({ feishuOpenId: openId, locale })
    .onConflictDoUpdate({ target: schema.userNotificationPrefs.feishuOpenId, set: { locale } });
}

export async function setChatLocale(ctx: AppContext, chatId: string, locale: Locale | null) {
  await ctx.db
    .insert(schema.chatSettings)
    .values({ feishuChatId: chatId, locale })
    .onConflictDoUpdate({ target: schema.chatSettings.feishuChatId, set: { locale } });
}

export async function setWorkspaceLocale(ctx: AppContext, locale: Locale) {
  await ctx.db
    .insert(schema.appSettings)
    .values({ key: SETTING_WORKSPACE_LOCALE, value: locale })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: locale } });
}
