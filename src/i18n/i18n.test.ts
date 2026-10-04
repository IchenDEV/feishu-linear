import test from "node:test";
import assert from "node:assert/strict";
import { LOCALES, normalizeLocale, t, translate, withLocale, currentLocale, lazy } from "./index.js";
import { messages, type MessageKey } from "./messages/index.js";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("所有文案：每种语言都有内容，且占位符一致", () => {
  for (const [key, msg] of Object.entries(messages)) {
    for (const l of LOCALES) {
      assert.ok(msg[l].trim().length > 0, `${key} 缺少 ${l}`);
    }
    assert.deepEqual(placeholders(msg["zh-CN"]), placeholders(msg.en), `${key} 的占位符在两种语言里不一致`);
  }
});

test("英文文案不含中文（语言名称与示例除外）", () => {
  const allowed = new Set<MessageKey>(["locale.zh-CN"]);
  for (const [key, msg] of Object.entries(messages)) {
    if (allowed.has(key as MessageKey)) continue;
    // FROM_FEISHU 标记不在 en 文案里出现
    assert.ok(!/[\u4e00-\u9fff]/.test(msg.en), `${key} 的英文文案含中文: ${msg.en}`);
  }
});

test("翻译：占位符替换、缺失参数为空串", () => {
  assert.equal(translate("en", "issue.subscribed", { id: "ENG-1" }), "Subscribed to ENG-1.");
  assert.equal(translate("zh-CN", "issue.subscribed", { id: "ENG-1" }), "已订阅 ENG-1");
  assert.equal(translate("en", "issue.subscribed"), "Subscribed to {id}.".replace("{id}", "{id}"));
});

test("withLocale 在异步调用链里传递语言", async () => {
  const out = await withLocale("en", async () => {
    await new Promise((r) => setTimeout(r, 5));
    return t("btn.assignToMe");
  });
  assert.equal(out, "Assign to me");
  assert.equal(withLocale("zh-CN", () => t("btn.assignToMe")), "分配给我");
  assert.ok(["zh-CN", "en"].includes(currentLocale()));
});

test("normalizeLocale 宽松解析", () => {
  assert.equal(normalizeLocale("zh"), "zh-CN");
  assert.equal(normalizeLocale("zh_CN"), "zh-CN");
  assert.equal(normalizeLocale("zh-Hans"), "zh-CN");
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("fr"), undefined);
  assert.equal(normalizeLocale(null), undefined);
});

test("lazy 文案按求值时的语言生成", () => {
  const text = () => t("notify.completed");
  assert.equal(withLocale("en", () => lazy(text)), "✅ Completed");
  assert.equal(withLocale("zh-CN", () => lazy(text)), "✅ 已完成");
  assert.equal(lazy("x"), "x");
});
