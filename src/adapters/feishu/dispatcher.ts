import * as lark from "@larksuiteoapi/node-sdk";
import type { AppContext } from "../../app/context.js";
import { createFeishuHandlers } from "./handlers.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("feishu-dispatcher");

/**
 * 统一用官方 EventDispatcher：
 * - Webhook：adaptKoaRouter 自动验签 / challenge / 解密
 * - 长连接：WSClient.start({ eventDispatcher })
 */
export function createFeishuEventDispatcher(ctx: AppContext) {
  const handlers = createFeishuHandlers(ctx);

  const dispatcher = new lark.EventDispatcher({
    encryptKey: ctx.config.FEISHU_ENCRYPT_KEY || undefined,
    verificationToken: ctx.config.FEISHU_VERIFICATION_TOKEN || undefined,
  }).register({
    "im.message.receive_v1": async (data) => {
      // 异步处理，尽快返回避免超时；长连接模式 SDK 会等待返回值
      // 对消息事件无需返回业务体，返回即可
      setImmediate(() => {
        handlers.onMessageReceive(data as unknown as Record<string, unknown>).catch(
          (err) => log.error({ err }, "消息事件处理失败"),
        );
      });
    },

    "application.bot.menu_v6": async (data) => {
      setImmediate(() => {
        handlers.onBotMenu(data as unknown as Record<string, unknown>).catch(
          (err) => log.error({ err }, "菜单事件处理失败"),
        );
      });
    },

    // 回调：必须同步返回响应体（3 秒内）
    "card.action.trigger": async (data: unknown) => {
      return handlers.onCardAction(data as Record<string, unknown>);
    },

    "url.preview.get": async (data: unknown) => {
      return handlers.onLinkPreview(data as Record<string, unknown>);
    },
  });

  return dispatcher;
}

export function createFeishuWebhookMiddleware(
  dispatcher: lark.EventDispatcher,
) {
  // autoChallenge: true 自动处理 url_verification
  return lark.adaptKoaRouter(dispatcher, { autoChallenge: true });
}

export async function startFeishuWS(
  ctx: AppContext,
  dispatcher: lark.EventDispatcher,
) {
  const wsClient = new lark.WSClient({
    appId: ctx.config.FEISHU_APP_ID,
    appSecret: ctx.config.FEISHU_APP_SECRET,
    loggerLevel: lark.LoggerLevel.info,
  });

  log.info("启动飞书长连接 WSClient…");
  // start 会阻塞式保持连接；放到后台不要 await
  void wsClient.start({ eventDispatcher: dispatcher }).catch((err) => {
    log.error({ err }, "飞书长连接异常退出");
  });

  return wsClient;
}
