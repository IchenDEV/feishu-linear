import * as lark from "@larksuiteoapi/node-sdk";
import type { AppContext } from "../../app/context.js";
import { createFeishuHandlers } from "./handlers.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("feishu-dispatcher");

/**
 * 官方 EventDispatcher（webhook-only）：
 * 事件订阅、卡片回传交互、链接预览共用同一个请求地址，
 * 由 adaptKoaRouter 完成 challenge / 验签 / 解密后分发。
 */
export function createFeishuEventDispatcher(ctx: AppContext) {
  const handlers = createFeishuHandlers(ctx);

  return new lark.EventDispatcher({
    encryptKey: ctx.config.FEISHU_ENCRYPT_KEY || undefined,
    verificationToken: ctx.config.FEISHU_VERIFICATION_TOKEN,
  }).register({
    // 事件：必须 3 秒内 ACK，业务放到后台处理
    "im.message.receive_v1": async (data) => {
      setImmediate(() => {
        handlers
          .onMessageReceive(data as unknown as Record<string, unknown>)
          .catch((err) => log.error({ err }, "消息事件处理失败"));
      });
    },

    "application.bot.menu_v6": async (data) => {
      setImmediate(() => {
        handlers
          .onBotMenu(data as unknown as Record<string, unknown>)
          .catch((err) => log.error({ err }, "菜单事件处理失败"));
      });
    },

    // 回调：返回值即响应体，必须 3 秒内返回
    "card.action.trigger": async (data: unknown) => {
      return handlers.onCardAction(data as Record<string, unknown>);
    },

    "url.preview.get": async (data: unknown) => {
      return handlers.onLinkPreview(data as Record<string, unknown>);
    },
  });
}

export function createFeishuWebhookMiddleware(
  dispatcher: lark.EventDispatcher,
) {
  // autoChallenge: true 自动应答 url_verification
  return lark.adaptKoaRouter(dispatcher, { autoChallenge: true });
}
