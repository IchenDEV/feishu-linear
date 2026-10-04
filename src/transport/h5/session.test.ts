import test from "node:test";
import assert from "node:assert/strict";
import { signSession, verifySession } from "./session.js";

test("会话令牌：签发后可验证，篡改 / 过期 / 换密钥均失败", () => {
  const t = signSession("secret", "ou_1", 1_000);
  assert.equal(verifySession("secret", t, 2_000), "ou_1");
  assert.equal(verifySession("other", t, 2_000), null);
  assert.equal(verifySession("secret", t, 1_000 + 31 * 60 * 1000), null);
  const [p, s] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ o: "ou_evil", e: 9e15 })).toString("base64url");
  assert.equal(verifySession("secret", `${forged}.${s}`, 2_000), null);
  assert.equal(verifySession("secret", `${p}.`, 2_000), null);
  assert.equal(verifySession("secret", "garbage", 2_000), null);
});
