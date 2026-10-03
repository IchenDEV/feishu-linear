import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidFeishuToken } from "./dispatcher.js";

test("isValidFeishuToken：只接受完全一致的 token", () => {
  assert.equal(isValidFeishuToken("tok", "tok"), true);
  assert.equal(isValidFeishuToken("BAD", "tok"), false);
  assert.equal(isValidFeishuToken("", "tok"), false);
  assert.equal(isValidFeishuToken(undefined, "tok"), false);
  assert.equal(isValidFeishuToken("tok", ""), false);
});
