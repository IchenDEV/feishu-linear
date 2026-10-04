import test from "node:test";
import assert from "node:assert/strict";
import { extractLinearAssets, parseMessage } from "./content.js";

test("parseMessage：text 把 @_user_N 换成名字", () => {
  const p = parseMessage("om_1", "text", JSON.stringify({ text: "@_user_1 看下" }), { "@_user_1": "小明" });
  assert.equal(p.text, "@小明 看下");
});

test("parseMessage：post 解析链接 / 代码块 / 图片附件", () => {
  const p = parseMessage(
    "om_2",
    "post",
    JSON.stringify({
      zh_cn: {
        title: "标题",
        content: [
          [{ tag: "text", text: "见 " }, { tag: "a", text: "文档", href: "https://x.io" }],
          [{ tag: "img", image_key: "img_1" }],
          [{ tag: "code_block", language: "ts", text: "a()" }],
        ],
      },
    }),
  );
  assert.match(p.text, /\*\*标题\*\*/);
  assert.match(p.text, /\[文档\]\(https:\/\/x\.io\)/);
  assert.match(p.text, /```ts\na\(\)\n```/);
  assert.deepEqual(p.attachments.map((a) => [a.kind, a.key, a.messageId]), [["image", "img_1", "om_2"]]);
});

test("parseMessage：image / file / 非 JSON", () => {
  assert.equal(parseMessage("m", "image", JSON.stringify({ image_key: "k" })).attachments[0].key, "k");
  const f = parseMessage("m", "file", JSON.stringify({ file_key: "f", file_name: "a.pdf" }));
  assert.equal(f.attachments[0].name, "a.pdf");
  assert.equal(parseMessage("m", "text", "not json").text, "not json");
});

test("extractLinearAssets：抽出图片与上传文件，正文保留", () => {
  const md = "看图 ![shot](https://uploads.linear.app/a/b.png)\n\n文件 [报告.pdf](https://uploads.linear.app/c/d.pdf) 和 [网页](https://example.com)";
  const { text, assets } = extractLinearAssets(md);
  assert.deepEqual(assets.map((a) => [a.kind, a.name]), [["image", "shot"], ["file", "报告.pdf"]]);
  assert.ok(!text.includes("![shot]"));
  assert.match(text, /📎 报告\.pdf/);
  assert.match(text, /\[网页\]\(https:\/\/example\.com\)/);
});
