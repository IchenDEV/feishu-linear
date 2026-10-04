import test from "node:test";
import assert from "node:assert/strict";
import { LOCALES, translate, withLocale } from "../i18n/index.js";
import {
  buildCommentForm,
  buildCreateIssueForm,
  buildDocumentCard,
  buildInitiativeCard,
  buildIssueCard,
  buildIssueCompactCard,
  buildIssueNotifyCard,
  buildLinkIssueForm,
  buildProjectCard,
  buildResultCard,
} from "./issue.js";
import { buildPersonalPrefsCard, buildSettingsCard } from "./settings.js";

const issue = {
  identifier: "ENG-1",
  title: "标题",
  status: "In Progress",
  statusType: "started",
  url: "https://linear.app/x/issue/ENG-1",
  teamName: "Eng",
  createdAt: "2026-10-05",
  labels: ["bug"],
  description: "描述",
};

const makeCards = (): Record<string, Record<string, unknown>> => ({
  issue: buildIssueCard(issue, { chatId: "oc_1", messageId: "om_1" }),
  compact: buildIssueCompactCard(issue),
  notify: buildIssueNotifyCard({ title: "t", url: "https://x", action: "a", actor: "me" }),
  project: buildProjectCard({ name: "P", status: "started", url: "https://x" }),
  document: buildDocumentCard({ title: "D", url: "https://x" }),
  initiative: buildInitiativeCard({ name: "I", url: "https://x" }),
  comment: buildCommentForm({ issueId: "ENG-1" }),
  result: buildResultCard({ ok: true, title: "ok", url: "https://x" }),
  link: buildLinkIssueForm({ chatId: "oc_1", messageId: "om_1", allowSync: true }),
  create: buildCreateIssueForm({
    team: { id: "t1", name: "Eng" },
    teams: [{ id: "t1", name: "Eng" }, { id: "t2", name: "Ops" }],
    projects: [{ id: "p1", name: "P" }],
    states: [{ id: "s1", name: "Todo" }],
    labels: [{ id: "l1", name: "bug" }],
    templates: [{ id: "tp1", name: "Bug" }],
    defaults: { title: "x" },
    chatId: "oc_1",
    messageId: "om_1",
    allowSync: true,
  }),
  settings: buildSettingsCard({
    chatId: "oc_1",
    teams: [{ id: "t1", name: "Eng" }],
    projects: [],
    templates: [],
    defaults: {},
    subscriptions: [{ kind: "config", id: 1, type: "team", name: "Eng", triggers: "新建" }],
    workspace: { autoProjectChannels: false, privateProjectChannels: false },
    locale: { chat: "en", workspace: "zh-CN" },
  }),
  prefs: buildPersonalPrefsCard({
    enabled: true,
    onAssigned: true,
    onMentioned: true,
    onComment: true,
    onStatusChange: true,
  }),
});

// 飞书卡片 JSON 2.0 不支持的 1.0 写法
const FORBIDDEN = [`"tag":"action"`, `"tag":"note"`, `"multi_url"`, `"tag":"div"`, `"lark_md"`, `"wide_screen_mode"`];

for (const locale of LOCALES) {
  const cards = withLocale(locale, makeCards);
  for (const [name, c] of Object.entries(cards)) {
    test(`[${locale}] 卡片 ${name}：符合 JSON 2.0（无 1.0 遗留写法，共享卡片，体积合理）`, () => {
      const json = JSON.stringify(c);
      assert.equal(c.schema, "2.0");
      assert.equal((c.config as any).update_multi, true);
      for (const bad of FORBIDDEN) assert.ok(!json.includes(bad), `${name} 含 ${bad}`);
      assert.ok(json.length < 30 * 1024, "卡片需 < 30KB");
    });
  }
}

test("英文卡片不含中文界面文案", () => {
  const cards = withLocale("en", makeCards);
  for (const [name, c] of Object.entries(cards)) {
    // 数据本身（标题「标题」、描述「描述」、触发器「新建」）是传入的测试数据，排除后不应再有中文
    const json = JSON.stringify(c).replace(/标题|描述|新建|简体中文/g, "");
    assert.ok(!/[\u4e00-\u9fff]/.test(json), `${name} 在 en 下仍含中文`);
  }
});

test("Issue 卡片：回调携带会话上下文，已同步时不再出现同步按钮", () => {
  const withSync = JSON.stringify(buildIssueCard(issue, { chatId: "oc_1", messageId: "om_1" }));
  assert.ok(withSync.includes("upgrade_sync"));
  assert.ok(withSync.includes('"chatId":"oc_1"') && withSync.includes('"messageId":"om_1"'));
  const synced = JSON.stringify(buildIssueCard({ ...issue, synced: true }, { chatId: "oc_1", messageId: "om_1" }));
  assert.ok(!synced.includes("upgrade_sync"));
  // 无会话上下文（链接预览）也不出现
  assert.ok(!JSON.stringify(buildIssueCard(issue)).includes("upgrade_sync"));
});

test("创建表单：无源消息时不出现「同步线程」按钮", () => {
  const f = (allowSync: boolean) =>
    JSON.stringify(
      buildCreateIssueForm({
        team: { id: "t1", name: "Eng" },
        teams: [{ id: "t1", name: "Eng" }],
        projects: [],
        states: [],
        labels: [],
        templates: [],
        defaults: {},
        chatId: "oc_1",
        allowSync,
      }),
    );
  for (const locale of LOCALES) {
    withLocale(locale, () => {
      const label = translate(locale, "card.create.submitSync");
      assert.ok(f(true).includes(label));
      assert.ok(!f(false).includes(label));
    });
  }
});
