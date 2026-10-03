import { test } from "node:test";
import assert from "node:assert/strict";
import type { Context } from "koa";
import { requireBearer } from "./middleware.js";

function fakeCtx(auth?: string) {
  return {
    status: 404,
    body: undefined as unknown,
    get: (h: string) => (h.toLowerCase() === "authorization" ? (auth ?? "") : ""),
  } as unknown as Context;
}

test("requireBearer：token 未配置 → 503，不放行", async () => {
  let passed = false;
  const c = fakeCtx("Bearer x");
  await requireBearer(() => "", "管理 API")(c, async () => { passed = true; });
  assert.equal(c.status, 503);
  assert.equal(passed, false);
});

test("requireBearer：错误 / 缺失 token → 401", async () => {
  for (const h of [undefined, "Bearer nope", "Basic abc", "Bearer "]) {
    const c = fakeCtx(h);
    let passed = false;
    await requireBearer(() => "secret", "x")(c, async () => { passed = true; });
    assert.equal(c.status, 401, String(h));
    assert.equal(passed, false);
  }
});

test("requireBearer：正确 token → 放行", async () => {
  const c = fakeCtx("Bearer secret");
  let passed = false;
  await requireBearer(() => "secret", "x")(c, async () => { passed = true; });
  assert.equal(passed, true);
});
