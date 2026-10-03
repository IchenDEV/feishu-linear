import { timingSafeEqual } from "node:crypto";
import * as lark from "@larksuiteoapi/node-sdk";
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
 */
export function createFeishuEventDispatcher(ctx: AppContext) {
  const handlers = createFeishuHandlers(ctx);
  const expected = ctx.config.FEISHU_VERIFICATION_TOKEN;

  // 来源不合法时抛 401，由 Koa 错误中间件返回，业务 handler 不会执行
  const guard =
    <T>(fn: (data: Record<string, unknown>) => Promise<T>) =>
    async (data: unknown): Promise<T> => {
      const d = (data ?? {}) as Record<string, unknown>;
      if (!isValidFeishuToken(d.token, expected)) {
        throw Object.assign(new Error("invalid verification token"), {
          status: 401,
        });
      }
      return fn(d);
    };

  return new lark.EventDispatcher({
    encryptKey: ctx.config.FEISHU_ENCRYPT_KEY || undefined,
    verificationToken: ctx.config.FEISHU_VERIFICATION_TOKEN,
  }).register<Record<string, (data: unknown) => Promise<unknown>>>({
    // 事件：必须 3 秒内 ACK，业务放到后台处理
    "im.message.receive_v1": guard(async (data) => {
      runInBackground("feishu-message", () => handlers.onMessageReceive(data));
    }),

    "application.bot.menu_v6": guard(async (data) => {
      runInBackground("feishu-menu", () => handlers.onBotMenu(data));
    }),

    // 回调：返回值即响应体，必须 3 秒内返回
    "card.action.trigger": guard((data) => handlers.onCardAction(data)),

    "url.preview.get": guard((data) => handlers.onLinkPreview(data)),
  });
}

export function createFeishuWebhookMiddleware(
  dispatcher: lark.EventDispatcher,
) {
  // autoChallenge: true 自动应答 url_verification
  return lark.adaptKoaRouter(dispatcher, { autoChallenge: true });
}
