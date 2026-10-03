import { describe, it } from "node:test";
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
