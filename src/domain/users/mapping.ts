import { eq, inArray } from "drizzle-orm";
import type { AppContext } from "../../app/context.js";
import { schema } from "../../db/index.js";
import * as feishu from "../../adapters/feishu/client.js";
import * as linearApi from "../../adapters/linear/api.js";
import { t } from "../../i18n/index.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("user-mapping");

export async function getMappingByFeishuOpenId(ctx: AppContext, openId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.userMappings)
    .where(eq(schema.userMappings.feishuOpenId, openId))
    .limit(1);
  return row;
}

export async function getMappingByLinearUserId(ctx: AppContext, linearUserId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.userMappings)
    .where(eq(schema.userMappings.linearUserId, linearUserId))
    .limit(1);
  return row;
}

export async function bindByEmail(
  ctx: AppContext,
  opts: {
    feishuOpenId: string;
    linearEmail: string;
    feishuName?: string;
    feishuUnionId?: string;
  },
) {
  const linear = await ctx.getLinear();
  const user = await linearApi.findUserByEmail(linear, opts.linearEmail);
  if (!user) {
    throw new Error(t("bind.userNotFound", { email: opts.linearEmail }));
  }

  await ctx.db
    .insert(schema.userMappings)
    .values({
      feishuOpenId: opts.feishuOpenId,
      feishuUnionId: opts.feishuUnionId,
      feishuName: opts.feishuName,
      feishuEmail: opts.linearEmail,
      linearUserId: user.id,
      linearEmail: user.email,
      linearName: user.name,
    })
    .onConflictDoUpdate({
      target: schema.userMappings.feishuOpenId,
      set: {
        linearUserId: user.id,
        linearEmail: user.email,
        linearName: user.name,
        feishuName: opts.feishuName,
        feishuEmail: opts.linearEmail,
      },
    });

  log.info(
    { feishuOpenId: opts.feishuOpenId, linear: user.name },
    "User linked",
  );

  return { linearUserId: user.id, linearName: user.name, linearEmail: user.email };
}

/** 读取飞书通讯录里该用户的邮箱（个人邮箱与企业邮箱） */
async function getFeishuEmails(ctx: AppContext, openId: string) {
  const res = await feishu.getUser(ctx.lark, openId);
  const user = (res.data as Record<string, unknown>)?.user as Record<string, unknown> | undefined;
  const emails = [user?.email, user?.enterprise_email]
    .filter((e): e is string => typeof e === "string" && e.length > 0)
    .map((e) => e.trim().toLowerCase());
  return {
    emails,
    name: user?.name as string | undefined,
    unionId: user?.union_id as string | undefined,
  };
}

/**
 * 用户自助绑定：只允许绑定与自己飞书账号邮箱一致的 Linear 账号，防止冒用他人身份。
 * （管理员可通过 /api/bind 为他人绑定。）
 */
export async function bindVerified(ctx: AppContext, openId: string, linearEmail: string) {
  const email = linearEmail.trim().toLowerCase();
  const f = await getFeishuEmails(ctx, openId);
  if (!f.emails.length) throw new Error(t("bind.noFeishuEmail"));
  if (!f.emails.includes(email)) throw new Error(t("bind.emailMismatch"));
  return bindByEmail(ctx, {
    feishuOpenId: openId,
    linearEmail: email,
    feishuName: f.name,
    feishuUnionId: f.unionId,
  });
}

/** 尝试用飞书用户邮箱自动匹配 Linear 用户 */
export async function autoBindFromFeishuUser(
  ctx: AppContext,
  openId: string,
): Promise<string | null> {
  const existing = await getMappingByFeishuOpenId(ctx, openId);
  if (existing) return existing.linearUserId;

  try {
    const res = await feishu.getUser(ctx.lark, openId);
    const user = (res.data as Record<string, unknown>)?.user as
      | Record<string, unknown>
      | undefined;
    const email =
      (user?.email as string | undefined) ||
      (user?.enterprise_email as string | undefined);
    const name = user?.name as string | undefined;
    const unionId = (user?.union_id as string | undefined) ?? undefined;

    if (!email) {
      log.debug({ openId }, "Feishu user has no email; cannot auto-link");
      return null;
    }

    const bound = await bindByEmail(ctx, {
      feishuOpenId: openId,
      linearEmail: email,
      feishuName: name,
      feishuUnionId: unionId,
    });
    return bound.linearUserId;
  } catch (err) {
    log.warn({ err, openId }, "Auto-link failed");
    return null;
  }
}

/** 未绑定 Linear 账号（建 Issue / 评论等需要 Linear 账号，对标 Slack 集成的限制） */
export class NotBoundError extends Error {
  constructor() {
    super(t("bind.notBound"));
    this.name = "NotBoundError";
  }
}

export interface LinearIdentity {
  linearUserId: string;
  linearName: string | null;
  linearEmail: string | null;
}

/** 解析操作者的 Linear 身份：已绑定直接返回，否则尝试按飞书邮箱自动绑定；失败返回 null */
export async function resolveLinearIdentity(
  ctx: AppContext,
  openId: string,
): Promise<LinearIdentity | null> {
  const existing = await getMappingByFeishuOpenId(ctx, openId);
  if (existing) {
    return {
      linearUserId: existing.linearUserId,
      linearName: existing.linearName,
      linearEmail: existing.linearEmail,
    };
  }
  const id = await autoBindFromFeishuUser(ctx, openId);
  if (!id) return null;
  const mapping = await getMappingByFeishuOpenId(ctx, openId);
  return {
    linearUserId: id,
    linearName: mapping?.linearName ?? null,
    linearEmail: mapping?.linearEmail ?? null,
  };
}

export async function requireLinearIdentity(
  ctx: AppContext,
  openId: string,
): Promise<LinearIdentity> {
  const identity = await resolveLinearIdentity(ctx, openId);
  if (!identity) throw new NotBoundError();
  return identity;
}

/** 该飞书用户是否对应 Linear 工作区管理员 */
export async function isLinearAdmin(
  ctx: AppContext,
  openId: string,
): Promise<boolean> {
  const identity = await resolveLinearIdentity(ctx, openId);
  if (!identity) return false;
  try {
    const linear = await ctx.getLinear();
    const user = await linear.user(identity.linearUserId);
    return Boolean(user.admin);
  } catch {
    return false;
  }
}

/** 飞书用户姓名（进程内缓存 10 分钟，失败回退） */
const nameCache = new Map<string, { name: string; at: number }>();
export async function getFeishuUserName(
  ctx: AppContext,
  openId: string,
  fallback = t("bind.unknownUser"),
): Promise<string> {
  const hit = nameCache.get(openId);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.name;
  const profile = await feishu.getUserProfile(ctx.lark, openId);
  const name = profile.name || fallback;
  if (profile.name) nameCache.set(openId, { name, at: Date.now() });
  return name;
}

/** 批量把 Linear 用户 ID 映射为飞书 open_id（未绑定的忽略） */
export async function feishuOpenIdsForLinearUsers(
  ctx: AppContext,
  linearUserIds: string[],
): Promise<string[]> {
  if (!linearUserIds.length) return [];
  const rows = await ctx.db
    .select()
    .from(schema.userMappings)
    .where(inArray(schema.userMappings.linearUserId, linearUserIds));
  return rows.map((r) => r.feishuOpenId);
}

/** 所有已绑定用户（用于 @ 提及匹配） */
export async function listMappings(ctx: AppContext) {
  return ctx.db.select().from(schema.userMappings);
}
