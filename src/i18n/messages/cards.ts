import type { Catalog } from "./types.js";

/** Issue / Project / 表单等卡片文案 */
export const cards = {
  // ── 通用字段名 ──
  "field.status": { "zh-CN": "状态", en: "Status" },
  "field.assignee": { "zh-CN": "负责人", en: "Assignee" },
  "field.priority": { "zh-CN": "优先级", en: "Priority" },
  "field.team": { "zh-CN": "团队", en: "Team" },
  "field.project": { "zh-CN": "项目", en: "Project" },
  "field.dueDate": { "zh-CN": "截止", en: "Due" },
  "field.actor": { "zh-CN": "操作者", en: "By" },
  "field.lead": { "zh-CN": "负责人", en: "Lead" },
  "field.owner": { "zh-CN": "负责人", en: "Owner" },
  "field.targetDate": { "zh-CN": "目标日期", en: "Target date" },
  "field.progress": { "zh-CN": "进度", en: "Progress" },
  "field.unassigned": { "zh-CN": "未分配", en: "Unassigned" },

  "priority.none": { "zh-CN": "无优先级", en: "No priority" },
  "priority.urgent": { "zh-CN": "🔴 紧急", en: "🔴 Urgent" },
  "priority.high": { "zh-CN": "🟠 高", en: "🟠 High" },
  "priority.medium": { "zh-CN": "🟡 中", en: "🟡 Medium" },
  "priority.low": { "zh-CN": "🔵 低", en: "🔵 Low" },
  "priority.urgent.plain": { "zh-CN": "紧急", en: "Urgent" },
  "priority.high.plain": { "zh-CN": "高", en: "High" },
  "priority.medium.plain": { "zh-CN": "中", en: "Medium" },
  "priority.low.plain": { "zh-CN": "低", en: "Low" },

  // ── 按钮 ──
  "btn.openInLinear": { "zh-CN": "在 Linear 中打开", en: "Open in Linear" },
  "btn.open": { "zh-CN": "打开", en: "Open" },
  "btn.viewDetails": { "zh-CN": "查看详情", en: "View details" },
  "btn.assignToMe": { "zh-CN": "分配给我", en: "Assign to me" },
  "btn.subscribe": { "zh-CN": "订阅", en: "Subscribe" },
  "btn.unsubscribe": { "zh-CN": "取消订阅", en: "Unsubscribe" },
  "btn.syncThread": { "zh-CN": "同步此线程", en: "Sync this thread" },
  "btn.comment": { "zh-CN": "评论", en: "Comment" },
  "btn.postComment": { "zh-CN": "发表评论", en: "Post comment" },
  "btn.viewProject": { "zh-CN": "查看项目", en: "View project" },
  "btn.openDocument": { "zh-CN": "打开文档", en: "Open document" },
  "btn.viewInitiative": { "zh-CN": "查看 Initiative", en: "View initiative" },

  // ── Issue 卡片 ──
  "card.issue.assignPlaceholder": { "zh-CN": "指派给…", en: "Assign to…" },
  "card.issue.commentPlaceholder": {
    "zh-CN": "添加评论（将以你的 Linear 账号发布）",
    en: "Add a comment (posted as your Linear account)",
  },
  "card.issue.createdAt": { "zh-CN": "创建于 {date}", en: "Created {date}" },
  "card.issue.threadSynced": { "zh-CN": "已同步线程", en: "Thread synced" },
  "card.document.updatedAt": { "zh-CN": "更新于 {date}", en: "Updated {date}" },

  // ── 创建 Issue 表单 ──
  "card.create.title": { "zh-CN": "📝 创建 Linear Issue", en: "📝 Create Linear issue" },
  "card.create.team": {
    "zh-CN": "**团队：{team}**　（切换团队会重置表单中的状态/标签/模板选项）",
    en: "**Team: {team}**  (switching teams resets status, label and template options)",
  },
  "card.create.switchTeam": { "zh-CN": "切换到 {team}", en: "Switch to {team}" },
  "card.create.titleInput": { "zh-CN": "Issue 标题", en: "Issue title" },
  "card.create.descInput": {
    "zh-CN": "描述（可选，支持 Markdown）",
    en: "Description (optional, Markdown supported)",
  },
  "card.create.project": { "zh-CN": "项目（可选）", en: "Project (optional)" },
  "card.create.state": { "zh-CN": "状态（可选）", en: "Status (optional)" },
  "card.create.priority": { "zh-CN": "优先级（可选）", en: "Priority (optional)" },
  "card.create.assignee": { "zh-CN": "负责人（默认：我）", en: "Assignee (default: me)" },
  "card.create.labels": { "zh-CN": "标签（可多选）", en: "Labels (multi-select)" },
  "card.create.template": { "zh-CN": "模板（可选）", en: "Template (optional)" },
  "card.create.submit": { "zh-CN": "创建 Issue", en: "Create issue" },
  "card.create.submitSync": { "zh-CN": "创建并同步线程", en: "Create & sync thread" },

  // ── 关联已有 Issue 表单 ──
  "card.link.title": { "zh-CN": "🔗 关联已有 Linear Issue", en: "🔗 Link an existing Linear issue" },
  "card.link.input": {
    "zh-CN": "输入 Issue 编号或链接，如 ENG-123",
    en: "Issue key or URL, e.g. ENG-123",
  },
  "card.link.submit": { "zh-CN": "关联", en: "Link" },
  "card.link.submitSync": { "zh-CN": "关联并同步线程", en: "Link & sync thread" },

  // ── 评论表单 ──
  "card.comment.title": { "zh-CN": "💬 评论 {issue}", en: "💬 Comment on {issue}" },
  "card.comment.input": {
    "zh-CN": "评论内容（将以你的 Linear 账号发布）",
    en: "Comment (posted as your Linear account)",
  },

  // ── 通知卡片 ──
  "card.notify.actor": { "zh-CN": "操作者", en: "By" },
} satisfies Catalog;
