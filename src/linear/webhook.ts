import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("linear-webhook");

// Linear Webhook 签名验证中间件
export function verifyLinearSignature(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!secret) {
      log.warn("未配置 LINEAR_WEBHOOK_SECRET，跳过签名验证");
      next();
      return;
    }

    const signature = req.headers["linear-signature"] as string;
    if (!signature) {
      log.warn("缺少 Linear-Signature 头");
      res.status(401).json({ error: "Missing signature" });
      return;
    }

    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      log.warn("无法获取原始请求体");
      res.status(400).json({ error: "Missing raw body" });
      return;
    }

    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

    const sigBuf = Buffer.from(signature, "hex");
    const expBuf = Buffer.from(expected, "hex");

    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      log.warn("签名验证失败");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    // 时间戳防重放（±5分钟）
    const body = JSON.parse(rawBody.toString());
    if (body.webhookTimestamp) {
      const ts = body.webhookTimestamp * 1000;
      const now = Date.now();
      if (Math.abs(now - ts) > 5 * 60 * 1000) {
        log.warn({ delta: now - ts }, "Webhook 时间戳过期");
        res.status(401).json({ error: "Stale webhook" });
        return;
      }
    }

    next();
  };
}

// Linear Webhook 事件类型
export interface LinearWebhookPayload {
  action: "create" | "update" | "remove";
  type: string;
  data: Record<string, unknown>;
  url?: string;
  updatedFrom?: Record<string, unknown>;
  createdAt: string;
  webhookTimestamp?: number;
  actor?: {
    id: string;
    type: string;
    name?: string;
  };
}

// 判断是否为本应用触发的事件（防回声）
export function isEchoEvent(
  payload: LinearWebhookPayload,
  appActorId?: string,
): boolean {
  if (!appActorId || !payload.actor) return false;
  return payload.actor.id === appActorId;
}
