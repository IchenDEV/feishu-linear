import { timingSafeEqual } from "node:crypto";
import * as lark from "@larksuiteoapi/node-sdk";
import type { Context, Next } from "koa";
import type { AppContext } from "../../app/context.js";
import { createFeishuHandlers } from "./handlers.js";
import { runInBackground } from "../../utils/background.js";

/**
 * 校验推送来源。
 * 注意：SDK 只在配置了 Encrypt Key 时才校验签名，Verification Token 本身并不会被 SDK 比对，
 * 所以这里对每个事件/回调自行比对 header.token（SDK 解析后合并到 data.token）。
 */
export function isValidFeishuToken(given: unknown, expected: string): boolean {
  if (typeof given !== "string" || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * 官方 EventDispatcher（webhook-only）：
 * 事件订阅、卡片回传交互、链接预览共用同一个请求地址，
 * 由 adaptKoaRouter 完成 challenge / 验签 / 解密后分发。
 *
 * 来源校验在 `createFeishuWebhookMiddleware` 里做（见该函数注释）。
 */
export function createFeishuEventDispatcher(ctx: AppContext) {
  const handlers = createFeishuHandlers(ctx);

  return new lark.EventDispatcher({
    encryptKey: ctx.config.FEISHU_ENCRYPT_KEY || undefined,
    verificationToken: ctx.config.FEISHU_VERIFICATION_TOKEN,
  }).register<Record<string, (data: unknown) => Promise<unknown>>>({
    // 事件：必须 3 秒内 ACK，业务放到后台处理
    "im.message.receive_v1": async (data: unknown) => {
      runInBackground("feishu-message", () =>
        handlers.onMessageReceive(data as Record<string, unknown>),
      );
    },

    "application.bot.menu_v6": async (data: unknown) => {
      runInBackground("feishu-menu", () =>
        handlers.onBotMenu(data as Record<string, unknown>),
      );
    },

    // 已读回执：不处理，仅避免 SDK 报 "no handle" 警告
    "im.message.message_read_v1": async () => {},

    // 回调：返回值即响应体，必须 3 秒内返回
    "card.action.trigger": (data: unknown) =>
      handlers.onCardAction(data as Record<string, unknown>),

    "url.preview.get": (data: unknown) =>
      handlers.onLinkPreview(data as Record<string, unknown>),
  });
}

/**
 * 来源校验 + 适配 Koa。
 *
 * 为什么不在 handler 里校验 token：SDK 把 header 与 event 合并成一个对象，
 * 卡片回调的 `event.token`（卡片更新凭证）会覆盖 `header.token`（Verification Token），
 * 到 handler 时已无法区分。所以在 SDK 之前，直接校验原始 body 的 `header.token`。
 * 配置了 Encrypt Key 时，body 是密文，由 SDK 按签名校验。
 */
export function createFeishuWebhookMiddleware(
  dispatcher: lark.EventDispatcher,
  verificationToken: string,
) {
  // autoChallenge: true 自动应答 url_verification
  const adapted = lark.adaptKoaRouter(dispatcher, { autoChallenge: true });
  return async (koaCtx: Context, next: Next) => {
    const body = (koaCtx.request.body ?? {}) as Record<string, any>;
    if (!body.encrypt) {
      const given = body.header?.token ?? body.token;
      if (!isValidFeishuToken(given, verificationToken)) {
        koaCtx.status = 401;
        koaCtx.body = { error: "invalid verification token" };
        return;
      }
    }
    return adapted(koaCtx, next);
  };
}
