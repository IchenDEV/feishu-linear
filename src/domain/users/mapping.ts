import { eq } from "drizzle-orm";
import type { AppContext } from "../../app/context.js";
import { schema } from "../../db/index.js";
import * as feishu from "../../adapters/feishu/client.js";
import * as linearApi from "../../adapters/linear/api.js";
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
    throw new Error(`未找到 Linear 用户: ${opts.linearEmail}`);
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
    "用户已绑定",
  );

  return { linearUserId: user.id, linearName: user.name, linearEmail: user.email };
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
      log.debug({ openId }, "飞书用户无邮箱，无法自动绑定");
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
    log.warn({ err, openId }, "自动绑定失败");
    return null;
  }
}
