import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * H5 页面会话令牌：HMAC-SHA256(app_secret, payload)。
 * 令牌只证明「这个 open_id 刚通过飞书登录」，有效期 30 分钟。
 */
const TTL_MS = 30 * 60 * 1000;

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signSession(secret: string, openId: string, now = Date.now()): string {
  const payload = b64(JSON.stringify({ o: openId, e: now + TTL_MS }));
  const sig = b64(createHmac("sha256", secret).update(payload).digest());
  return `${payload}.${sig}`;
}

/** 校验并返回 open_id；无效 / 过期返回 null */
export function verifySession(secret: string, token: string, now = Date.now()): string | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { o, e } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof o === "string" && typeof e === "number" && e > now ? o : null;
  } catch {
    return null;
  }
}
