import type { AppContext } from "../../app/context.js";
import * as linearApi from "../linear/api.js";
import * as feishu from "./client.js";
import { runInBackground } from "../../utils/background.js";
import {
  buildCommentForm,
  buildResultCard,
} from "../../cards/issue.js";
import { buildPersonalPrefsCard } from "../../cards/settings.js";
import {
  assignIssueToLinearUser,
  commentOnIssue,
  createIssueFromFeishu,
  issueCard,
  linkExistingIssue,
  setIssueSubscription,
  upgradeToSyncThread,
} from "../../domain/issues/service.js";
import { buildCreateForm, deliverPrivately } from "../../domain/issues/form.js";
import { fetchSourceMessage } from "../../domain/messages/source.js";
import {
  NotBoundError,
  resolveLinearIdentity,
} from "../../domain/users/mapping.js";
import {
  addSub,
  buildSettingsForChat,
  clearChatDefaults,
  ForbiddenError,
  permissions,
  removeSub,
  requireConfigurer,
  saveChatDefaults,
  saveGuidance,
  setAsks,
  toggleWorkspaceFlag,
} from "../../domain/settings/service.js";
import {
  SETTING_AUTO_PROJECT_CHANNELS,
  SETTING_PROJECT_CHANNEL_PRIVATE,
} from "../../domain/settings/store.js";
import { getPrefs, setPrefs } from "../../domain/notify/engine.js";
import { t } from "../../i18n/index.js";
import {
  resolveLocale,
  setChatLocale,
  setUserLocale,
  setWorkspaceLocale,
} from "../../i18n/resolve.js";
import { normalizeLocale, withLocale } from "../../i18n/index.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("card-actions");

type Json = Record<string, any>;

const toast = (type: "success" | "error" | "info" | "warning", content: string) => ({
  toast: { type, content },
});
const rawCard = (data: Record<string, unknown>) => ({ card: { type: "raw", data } });

const asStr = (v: unknown) => (typeof v === "string" ? v : undefined);
const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? [v] : [];

function errText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/** 卡片回传交互总入口：按操作者 / 群解析界面语言后处理 */
export async function handleCardAction(ctx: AppContext, data: Json) {
  const raw = (data.action ?? {}) as Json;
  let v: Json = {};
  try {
    v = typeof raw.value === "string" ? JSON.parse(raw.value) : (raw.value ?? {});
  } catch {
    v = {};
  }
  const chat = asStr(v.chatId) || asStr(data.context?.open_chat_id);
  const locale = await resolveLocale(ctx, { openId: data.operator?.open_id, chatId: chat });
  return withLocale(locale, () => handleCardActionLocalized(ctx, data));
}

/** 必须 3 秒内返回；耗时操作先返回「处理中」，再用 token 延时更新卡片 */
async function handleCardActionLocalized(ctx: AppContext, data: Json) {
  const action = (data.action ?? {}) as Json;
  const operatorOpenId: string = data.operator?.open_id;
  const context = (data.context ?? {}) as Json;
  const updateToken: string | undefined = asStr(data.token);

  let value: Json = {};
  try {
    value =
      typeof action.value === "string"
        ? JSON.parse(action.value)
        : (action.value ?? {});
  } catch {
    value = {};
  }
  const form: Json = action.form_value ?? {};
  const name = asStr(value.action);

  // 卡片所在会话：优先 value 里带的，其次回调 context
  const chatId = asStr(value.chatId) || asStr(context.open_chat_id) || "";

  try {
    switch (name) {
      // ───────── Issue 卡片上的内联操作 ─────────
      case "assign_to_me":
      case "assign_to": {
        let targetLinearId: string | undefined;
        if (name === "assign_to") {
          const pickedOpenId = asStr(action.option);
          if (!pickedOpenId) return toast("error", t("action.noAssignee"));
          const target = await resolveLinearIdentity(ctx, pickedOpenId);
          if (!target) return toast("warning", t("action.assigneeNotBound"));
          targetLinearId = target.linearUserId;
        }
        const r = await assignIssueToLinearUser(ctx, {
          issueKey: String(value.issueId),
          operatorOpenId,
          assigneeLinearId: targetLinearId,
        });
        return { ...toast(r.success ? "success" : "error", r.message), ...(await refreshIssueCard(ctx, value, chatId)) };
      }

      case "subscribe_issue":
      case "unsubscribe_issue": {
        const r = await setIssueSubscription(ctx, {
          issueKey: String(value.issueId),
          operatorOpenId,
          subscribe: name === "subscribe_issue",
        });
        return toast(r.success ? "success" : "error", r.message);
      }

      case "comment_issue": {
        const body = asStr(form.comment)?.trim();
        if (!body) return toast("error", t("action.fillComment"));
        const r = await commentOnIssue(ctx, {
          issueKey: String(value.issueId),
          operatorOpenId,
          body,
        });
        if (value.closeAfter) {
          return { ...toast("success", r.message), ...rawCard(buildResultCard({ ok: true, title: `✅ ${r.message}` })) };
        }
        return { ...toast(r.success ? "success" : "error", r.message), ...(await refreshIssueCard(ctx, value, chatId)) };
      }

      case "prompt_comment": {
        const linear = await ctx.getLinear();
        const issue = await linearApi.getIssue(linear, String(value.issueId));
        const card = buildCommentForm({ issueId: String(value.issueId), title: issue?.title });
        await deliverPrivately(ctx, {
          chatId,
          openId: operatorOpenId,
          card,
        });
        return toast("info", t("action.fillCommentPrompt"));
      }

      case "upgrade_sync": {
        const linear = await ctx.getLinear();
        const issue = await linearApi.getIssue(linear, String(value.issueId));
        if (!issue) return toast("error", t("issue.notFound", { key: String(value.issueId) }));
        const row = await upgradeToSyncThread(ctx, {
          issue,
          chatId,
          messageId: String(value.messageId),
          threadId: asStr(value.threadId) || undefined,
        });
        if (!row) return toast("error", t("action.syncFailed"));
        return { ...toast("success", t("action.syncDone")), ...(await refreshIssueCard(ctx, value, chatId)) };
      }

      // ───────── 创建 / 关联 Issue ─────────
      case "create_form_switch_team": {
        const card = await buildCreateForm(ctx, {
          chatId,
          messageId: asStr(value.messageId) || undefined,
          threadId: asStr(value.threadId) || undefined,
          teamId: asStr(value.teamId),
          title: asStr(value.title),
        });
        return rawCard(card);
      }

      case "open_create_issue_form": {
        const card = await buildCreateForm(ctx, {
          chatId,
          messageId: asStr(value.messageId) || undefined,
        });
        await deliverPrivately(ctx, { chatId, openId: operatorOpenId, card });
        return toast("info", t("action.fillForm"));
      }

      case "submit_create_issue": {
        const title = asStr(form.title)?.trim();
        if (!title) return toast("error", t("action.fillTitle"));
        if (!(await resolveLinearIdentity(ctx, operatorOpenId))) throw new NotBoundError();

        let assigneeLinearId: string | undefined;
        const pickedAssignee = asStr(form.assignee);
        if (pickedAssignee) {
          const picked = await resolveLinearIdentity(ctx, pickedAssignee);
          if (!picked) return toast("warning", t("action.assigneeNotBound2"));
          assigneeLinearId = picked.linearUserId;
        }
        const messageId = asStr(value.messageId) || undefined;
        const threadId = asStr(value.threadId) || undefined;

        const job = async () => {
          const src = messageId ? await fetchSourceMessage(ctx, messageId) : null;
          const { issue, synced } = await createIssueFromFeishu(ctx, {
            chatId,
            operatorOpenId,
            title,
            description: asStr(form.description),
            teamId: asStr(value.formTeamId),
            projectId: asStr(form.projectId),
            stateId: asStr(form.stateId),
            templateId: asStr(form.templateId),
            labelIds: asList(form.labelIds),
            priority: form.priority ? Number(form.priority) : undefined,
            assigneeLinearId,
            source: messageId
              ? { messageId, threadId, attachments: src?.attachments, excerpt: src?.text }
              : undefined,
            sync: Boolean(value.sync),
            replyInThread: Boolean(value.sync) || Boolean(threadId),
          });
          return buildResultCard({
            ok: true,
            title: t("action.created.title", { id: issue.identifier }),
            text: `${issue.title}${synced ? `\n${t("action.created.synced")}` : ""}\n\n${t("action.created.cardSent")}`,
            url: issue.url,
          });
        };
        return deferred(ctx, updateToken, t("action.label.create"), job, t("action.creating"));
      }

      case "submit_link_issue": {
        const key = asStr(form.issueKey)?.trim();
        if (!key) return toast("error", t("action.fillIssueKey"));
        const messageId = asStr(value.messageId) || undefined;
        const threadId = asStr(value.threadId) || undefined;
        const job = async () => {
          const src = messageId ? await fetchSourceMessage(ctx, messageId) : null;
          const { issue, synced } = await linkExistingIssue(ctx, {
            issueKey: key,
            chatId,
            operatorOpenId,
            messageId,
            threadId,
            excerpt: src?.text,
            attachments: src?.attachments,
            sync: Boolean(value.sync),
            replyInThread: Boolean(value.sync) || Boolean(threadId),
          });
          return buildResultCard({
            ok: true,
            title: t("action.linked.title", { id: issue.identifier }),
            text: `${issue.title}${synced ? `\n${t("action.created.synced")}` : ""}`,
            url: issue.url,
          });
        };
        return deferred(ctx, updateToken, t("action.label.link"), job, t("action.linking"));
      }

      // ───────── 设置 ─────────
      case "save_chat_defaults": {
        await saveChatDefaults(ctx, chatId, operatorOpenId, {
          teamId: asStr(form.teamId),
          projectId: asStr(form.projectId),
          templateId: asStr(form.templateId),
        });
        return { ...toast("success", t("action.saved")), ...rawCard(await buildSettingsForChat(ctx, chatId, operatorOpenId)) };
      }
      case "clear_chat_defaults": {
        await clearChatDefaults(ctx, chatId, operatorOpenId);
        return { ...toast("success", t("action.cleared")), ...rawCard(await buildSettingsForChat(ctx, chatId, operatorOpenId)) };
      }
      case "save_guidance": {
        await saveGuidance(
          ctx,
          chatId,
          operatorOpenId,
          value.scope === "workspace" ? "workspace" : "chat",
          asStr(form.guidance) ?? "",
        );
        return { ...toast("success", t("action.guidanceSaved")), ...rawCard(await buildSettingsForChat(ctx, chatId, operatorOpenId)) };
      }
      case "add_sub": {
        const type = asStr(form.subType) as "team" | "project" | "initiative" | "view" | undefined;
        const nameText = asStr(form.subName)?.trim();
        if (!type || !nameText) return toast("error", t("action.pickTypeAndName"));
        const ent = await addSub(ctx, chatId, operatorOpenId, {
          type,
          name: nameText,
          triggers: asList(form.triggers),
        });
        return { ...toast("success", t("action.subscribedTo", { name: ent.name })), ...rawCard(await buildSettingsForChat(ctx, chatId, operatorOpenId)) };
      }
      case "remove_sub": {
        await removeSub(ctx, chatId, operatorOpenId, value.kind === "view" ? "view" : "config", Number(value.id));
        return { ...toast("success", t("action.removed")), ...rawCard(await buildSettingsForChat(ctx, chatId, operatorOpenId)) };
      }
      case "enable_asks": {
        const teamId = asStr(form.teamId);
        if (!teamId) return toast("error", t("action.pickTeam"));
        await setAsks(ctx, chatId, operatorOpenId, teamId);
        return { ...toast("success", t("action.asksEnabled")), ...rawCard(await buildSettingsForChat(ctx, chatId, operatorOpenId)) };
      }
      case "disable_asks": {
        await setAsks(ctx, chatId, operatorOpenId, null);
        return { ...toast("success", t("action.asksDisabled")), ...rawCard(await buildSettingsForChat(ctx, chatId, operatorOpenId)) };
      }
      case "toggle_auto_channels":
      case "toggle_private_channels": {
        await toggleWorkspaceFlag(
          ctx,
          chatId,
          operatorOpenId,
          name === "toggle_auto_channels" ? SETTING_AUTO_PROJECT_CHANNELS : SETTING_PROJECT_CHANNEL_PRIVATE,
        );
        return rawCard(await buildSettingsForChat(ctx, chatId, operatorOpenId));
      }

      // ───────── 界面语言 ─────────
      case "set_chat_locale": {
        await requireConfigurer(ctx, chatId, operatorOpenId);
        const l = normalizeLocale(value.locale) ?? null;
        await setChatLocale(ctx, chatId, l);
        return withLocale(l ?? (await resolveLocale(ctx, { openId: operatorOpenId })), async () => ({
          ...toast("success", t("action.languageSet")),
          ...rawCard(await buildSettingsForChat(ctx, chatId, operatorOpenId)),
        }));
      }
      case "set_workspace_locale": {
        const perms = await permissions(ctx, chatId, operatorOpenId);
        if (!perms.linearAdmin) throw new ForbiddenError();
        const l = normalizeLocale(value.locale);
        if (l) await setWorkspaceLocale(ctx, l);
        return { ...toast("success", t("action.languageSet")), ...rawCard(await buildSettingsForChat(ctx, chatId, operatorOpenId)) };
      }
      case "set_user_locale": {
        const l = normalizeLocale(value.locale) ?? null;
        await setUserLocale(ctx, operatorOpenId, l);
        return withLocale(l ?? (await resolveLocale(ctx, {})), async () => ({
          ...toast("success", t("action.languageSet")),
          ...rawCard(buildPersonalPrefsCard(await getPrefs(ctx, operatorOpenId))),
        }));
      }

      // ───────── 个人通知偏好 ─────────
      case "toggle_pref": {
        const key = String(value.key) as "enabled" | "onAssigned" | "onMentioned" | "onComment" | "onStatusChange";
        const cur = await getPrefs(ctx, operatorOpenId);
        await setPrefs(ctx, operatorOpenId, { [key]: !cur[key] });
        return rawCard(buildPersonalPrefsCard(await getPrefs(ctx, operatorOpenId)));
      }

      default:
        return {};
    }
  } catch (err) {
    if (!(err instanceof NotBoundError) && !(err instanceof Error && err.name === "ForbiddenError")) {
      log.error({ err, action: name }, "Card action failed");
    }
    return toast("error", errText(err).slice(0, 120));
  }
}

/** 重新取 Issue 并生成最新卡片，用于操作后原地刷新（失败时不刷新） */
async function refreshIssueCard(ctx: AppContext, value: Json, chatId: string) {
  try {
    const linear = await ctx.getLinear();
    const issue = await linearApi.getIssue(linear, String(value.issueId));
    if (!issue) return {};
    const card = await issueCard(ctx, issue, {
      chatId: chatId || undefined,
      messageId: asStr(value.messageId) || undefined,
      threadId: asStr(value.threadId) || undefined,
    });
    return rawCard(card);
  } catch (err) {
    log.debug({ err }, "Failed to refresh the issue card");
    return {};
  }
}

/**
 * 耗时操作：立即返回「处理中」卡片（满足 3 秒时限），后台完成后用回调 token 延时更新为结果。
 */
function deferred(
  ctx: AppContext,
  token: string | undefined,
  label: string,
  job: () => Promise<Record<string, unknown>>,
  processingText: string,
) {
  runInBackground(`card-${label}`, async () => {
    let result: Record<string, unknown>;
    try {
      result = await job();
    } catch (err) {
      result = buildResultCard({
        ok: false,
        title: `❌ ${t("action.failed", { label })}`,
        text: errText(err),
      });
      if (!(err instanceof NotBoundError)) log.error({ err, label }, "Background card task failed");
    }
    if (!token) return;
    try {
      await feishu.updateCardByToken(ctx.lark, token, result);
    } catch (err) {
      log.warn({ err }, "Delayed card update failed");
    }
  });
  return {
    ...toast("info", processingText),
    ...rawCard(buildResultCard({ ok: true, title: `⏳ ${processingText}` })),
  };
}
