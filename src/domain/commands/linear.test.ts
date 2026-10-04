import test from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "./linear.js";

test("parseCommand：群里必须带 / 前缀", () => {
  assert.equal(parseCommand("help", "group"), null);
  assert.deepEqual(parseCommand("/linear", "group"), { cmd: "create", args: "" });
  assert.deepEqual(parseCommand("/linear 修复登录", "group"), { cmd: "修复登录", args: "" });
  assert.deepEqual(parseCommand("/linear create 修复登录 bug", "group"), { cmd: "create", args: "修复登录 bug" });
  assert.deepEqual(parseCommand("/linear bind a@b.com", "group"), { cmd: "bind", args: "a@b.com" });
  assert.deepEqual(parseCommand("/ask 能开个权限吗", "group"), { cmd: "ask", args: "能开个权限吗" });
  assert.deepEqual(parseCommand("/ASK x", "group"), { cmd: "ask", args: "x" });
});

test("parseCommand：私聊接受裸命令，其余走智能体", () => {
  assert.deepEqual(parseCommand("bind a@b.com", "p2p"), { cmd: "bind", args: "a@b.com" });
  assert.deepEqual(parseCommand("help", "p2p"), { cmd: "help", args: "" });
  assert.equal(parseCommand("帮我查下 ENG-1", "p2p"), null);
  assert.equal(parseCommand("/linearx", "group"), null);
});
