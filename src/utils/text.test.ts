import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectIssueIdentifiers,
  extractTextFromFeishuContent,
  isBotMentioned,
  parseLinearUrl,
  removeMentions,
} from "./text.js";

describe("text utils", () => {
  it("extracts text content", () => {
    assert.equal(
      extractTextFromFeishuContent('{"text":"@_user_1 hello"}', "text"),
      "@_user_1 hello",
    );
  });

  it("detects bot mention by mentioned_type", () => {
    assert.equal(
      isBotMentioned([{ key: "@_user_1", mentionedType: "bot" }]),
      true,
    );
    assert.equal(
      isBotMentioned([{ key: "@_user_1", mentionedType: "user" }]),
      false,
    );
  });

  it("parses issue identifiers and linear urls", () => {
    assert.deepEqual(detectIssueIdentifiers("fix ENG-482 please"), ["ENG-482"]);
    const parsed = parseLinearUrl(
      "https://linear.app/acme/issue/ENG-482/some-title",
    );
    assert.equal(parsed?.type, "issue");
    assert.equal(parsed?.identifier, "ENG-482");
  });

  it("removes mention tokens", () => {
    assert.equal(removeMentions("@_user_1 create a bug"), "create a bug");
  });
});

test("parseLinearUrl：issue / project / document / initiative，私有域名之外忽略", async () => {
  const { slugTail } = await import("./text.js");
  assert.deepEqual(parseLinearUrl("https://linear.app/acme/issue/eng-12/foo"), {
    type: "issue",
    teamKey: "eng",
    identifier: "ENG-12",
  });
  assert.deepEqual(parseLinearUrl("https://linear.app/acme/project/site-redesign-a1b2c3d4e5f6/overview"), {
    type: "project",
    id: "site-redesign-a1b2c3d4e5f6",
  });
  assert.equal(parseLinearUrl("https://linear.app/acme/document/spec-abc123")?.type, "document");
  assert.equal(parseLinearUrl("https://linear.app/acme/initiative/q4-abc123")?.type, "initiative");
  assert.equal(parseLinearUrl("https://evil.com/linear.app/acme/issue/ENG-1"), null);
  assert.equal(slugTail("site-redesign-a1b2c3d4e5f6"), "a1b2c3d4e5f6");
});
