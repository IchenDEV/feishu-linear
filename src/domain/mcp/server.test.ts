import test from "node:test";
import assert from "node:assert/strict";
import { handleRpc, mcpTools } from "./server.js";
import type { AppContext } from "../../app/context.js";

const ctx = {} as AppContext;

test("MCP：initialize / tools/list / 通知 / 未知方法", async () => {
  const init = (await handleRpc(ctx, { id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })) as any;
  assert.equal(init.result.serverInfo.name, "feishu-linear");
  assert.equal(await handleRpc(ctx, { method: "notifications/initialized" }), null);

  const list = (await handleRpc(ctx, { id: 2, method: "tools/list" })) as any;
  const names = list.result.tools.map((t: any) => t.name);
  assert.ok(names.includes("create_issue") && names.includes("feishu_read_messages"));
  assert.equal(new Set(names).size, names.length, "工具名不能重复");
  for (const t of mcpTools) assert.equal((t.parameters as any).type, "object");

  const bad = (await handleRpc(ctx, { id: 3, method: "nope" })) as any;
  assert.equal(bad.error.code, -32601);
  const unknown = (await handleRpc(ctx, { id: 4, method: "tools/call", params: { name: "x" } })) as any;
  assert.equal(unknown.error.code, -32602);
});
