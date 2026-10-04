import type { Catalog } from "./types.js";

/** Linear → 飞书 通知文案 */
export const notify = {
  "notify.newIssue": { "zh-CN": "新 Issue", en: "New issue" },
  "notify.assignedNew": { "zh-CN": "你被分配了新 Issue", en: "You were assigned a new issue" },
  "notify.completed": { "zh-CN": "✅ 已完成", en: "✅ Completed" },
  "notify.canceled": { "zh-CN": "❌ 已取消", en: "❌ Canceled" },
  "notify.statusChange": { "zh-CN": "状态变更", en: "Status changed" },
  "notify.issueStatusChange": { "zh-CN": "Issue 状态变更", en: "Issue status changed" },
  "notify.statusChangedTo": { "zh-CN": "状态变更为 **{status}**", en: "Status changed to **{status}**" },
  "notify.assigneeChange": { "zh-CN": "负责人变更", en: "Assignee changed" },
  "notify.assigneeChangedTo": { "zh-CN": "负责人变更为 **{name}**", en: "Assignee changed to **{name}**" },
  "notify.assignedToYou": { "zh-CN": "Issue 被分配给你", en: "Issue assigned to you" },
  "notify.priorityChange": { "zh-CN": "优先级变更", en: "Priority changed" },
  "notify.priorityChangedTo": { "zh-CN": "优先级变更为 **{name}**", en: "Priority changed to **{name}**" },
  "notify.newComment": { "zh-CN": "💬 新评论", en: "💬 New comment" },
  "notify.mentioned": { "zh-CN": "💬 你被 @ 提及", en: "💬 You were mentioned" },
  "notify.followedComment": {
    "zh-CN": "💬 你关注的 Issue 有新评论",
    en: "💬 New comment on an issue you follow",
  },
  "notify.projectStatusChange": { "zh-CN": "项目状态变更", en: "Project status changed" },
  "notify.projectStatusChangedTo": {
    "zh-CN": "项目状态变更为 **{status}**",
    en: "Project status changed to **{status}**",
  },
  "notify.projectUpdate": { "zh-CN": "项目更新{health}", en: "Project update{health}" },
  "notify.initiativeUpdate": { "zh-CN": "Initiative 更新{health}", en: "Initiative update{health}" },
  "notify.initiativeStatusChange": { "zh-CN": "Initiative 状态变更", en: "Initiative status changed" },
  "notify.health": { "zh-CN": "（{health}）", en: " ({health})" },
  "notify.projectFallback": { "zh-CN": "项目", en: "Project" },

  // ── 视图订阅 ──
  "notify.view.actor": { "zh-CN": "视图「{name}」", en: "View “{name}”" },
  "notify.view.added": { "zh-CN": "新进入视图", en: "New in view" },
  "notify.view.done": { "zh-CN": "视图内已完成", en: "Completed in view" },
  "notify.view.more": {
    "zh-CN": "视图「{name}」另有 {count} 个 Issue（{action}），请在 Linear 中查看。",
    en: "View “{name}” has {count} more issues ({action}). Open Linear to see them.",
  },

  // ── 项目频道 ──
  "channel.description": { "zh-CN": "Linear 项目：{name}\n{url}", en: "Linear project: {name}\n{url}" },
  "channel.tab": { "zh-CN": "Linear 项目", en: "Linear project" },
  "channel.createFailed": { "zh-CN": "创建群失败：未返回 chat_id", en: "Failed to create the channel: no chat_id returned." },
} satisfies Catalog;
