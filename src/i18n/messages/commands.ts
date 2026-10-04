import type { Catalog } from "./types.js";

/** 命令、绑定、Asks、通用错误 */
export const commands = {
  "help.text": {
    "zh-CN": [
      "Linear 连接器 · 命令（群里加 / 前缀，私聊可省略）",
      "• /linear — 打开「创建 Issue」表单；在话题内或回复某条消息时发送，会把那条消息转为 Issue",
      "• /linear create 标题 — 带标题预填表单",
      "• /linear link [ENG-123] — 把消息关联到已有 Issue",
      "• /linear sync ENG-123 — 让当前话题与 Issue 双向同步",
      "• /linear bind 邮箱 — 绑定你的 Linear 账号（邮箱须与飞书账号邮箱一致）",
      "• /linear me — 我的通知偏好",
      "• /linear lang zh|en|auto — 设置你的界面语言",
      "• /linear settings — 本群设置（默认团队/项目、订阅、Guidance、Asks、语言；群主/管理员）",
      "• /linear project-channel 项目名 — 为项目创建专属群（管理员）",
      "• /ask 内容 — 向团队提需求（无需 Linear 账号，需管理员先启用 Asks）",
      "• @机器人 + 自然语言 — 智能体帮你查询、创建、更新",
    ].join("\n"),
    en: [
      "Linear connector · commands (use the / prefix in channels; optional in direct messages)",
      "• /linear — open the “Create issue” form. Sent inside a thread or as a reply, it turns that message into an issue",
      "• /linear create <title> — open the form with a prefilled title",
      "• /linear link [ENG-123] — link the message to an existing issue",
      "• /linear sync ENG-123 — two-way sync this thread with an issue",
      "• /linear bind <email> — link your Linear account (the email must match your Feishu account)",
      "• /linear me — my notification preferences",
      "• /linear lang zh|en|auto — set your language",
      "• /linear settings — channel settings (defaults, subscriptions, guidance, Asks, language; channel admins)",
      "• /linear project-channel <project> — create a dedicated channel for a project (admins)",
      "• /ask <request> — send a request to the team (no Linear account needed; Asks must be enabled by an admin)",
      "• @bot + natural language — let the agent search, create and update issues for you",
    ].join("\n"),
  },

  "cmd.unknown": {
    "zh-CN": "不认识的命令「{cmd}」。\n\n{help}",
    en: "Unknown command “{cmd}”.\n\n{help}",
  },
  "cmd.bind.usage": { "zh-CN": "用法：/linear bind 你的Linear邮箱", en: "Usage: /linear bind <your Linear email>" },
  "cmd.bind.done": {
    "zh-CN": "✅ 已绑定 Linear 用户：{name}（{email}）",
    en: "✅ Linked to Linear user {name} ({email})",
  },
  "cmd.sync.usage": { "zh-CN": "用法：/linear sync ENG-123", en: "Usage: /linear sync ENG-123" },
  "cmd.settings.groupOnly": {
    "zh-CN": "请在需要配置的群里发送 /linear settings。",
    en: "Send /linear settings in the channel you want to configure.",
  },
  "cmd.settings.forbidden": {
    "zh-CN": "仅群主 / 群管理员 / Linear 管理员可以打开设置。",
    en: "Only the channel owner, channel admins or Linear admins can open the settings.",
  },
  "cmd.projectChannel.usage": {
    "zh-CN": "用法：/linear project-channel 项目名",
    en: "Usage: /linear project-channel <project name>",
  },
  "cmd.projectChannel.notFound": { "zh-CN": "未找到项目「{name}」", en: "Project “{name}” not found." },
  "cmd.projectChannel.done": {
    "zh-CN": "✅ 项目「{name}」的专属群已就绪（chat_id: {chatId}）",
    en: "✅ Channel for project “{name}” is ready (chat_id: {chatId}).",
  },
  "cmd.lang.usage": {
    "zh-CN": "用法：/linear lang zh|en|auto（当前：{current}）",
    en: "Usage: /linear lang zh|en|auto (current: {current})",
  },
  "cmd.lang.done": { "zh-CN": "✅ 已将你的界面语言设为 {lang}", en: "✅ Your language is now {lang}." },
  "cmd.lang.auto": { "zh-CN": "✅ 已恢复为跟随群 / 工作区语言", en: "✅ Your language now follows the channel / workspace default." },
  "cmd.error": { "zh-CN": "❌ {message}", en: "❌ {message}" },

  // ── 绑定 / 身份 ──
  "bind.notBound": {
    "zh-CN": "你还没有绑定 Linear 账号。请私聊机器人发送：/linear bind 你的Linear邮箱，例如 /linear bind you@company.com",
    en: "Your Feishu account isn't linked to Linear yet. Send the bot a direct message: /linear bind <your Linear email>, e.g. /linear bind you@company.com",
  },
  "bind.userNotFound": { "zh-CN": "未找到 Linear 用户：{email}", en: "No Linear user found for {email}." },
  "bind.noFeishuEmail": {
    "zh-CN": "无法确认你的身份：你的飞书账号没有可读取的邮箱（请在飞书个人资料中填写邮箱，或联系管理员协助绑定）。",
    en: "Unable to verify your identity: no email is available on your Feishu account. Add one to your Feishu profile, or ask an admin to link you.",
  },
  "bind.emailMismatch": {
    "zh-CN": "该邮箱与你的飞书账号邮箱不一致，不能绑定。请使用你自己的邮箱，或联系管理员协助绑定。",
    en: "That email doesn't match the email on your Feishu account. Use your own email, or ask an admin to link you.",
  },
  "bind.unknownUser": { "zh-CN": "飞书用户", en: "Feishu user" },

  // ── Asks ──
  "asks.notEnabled": {
    "zh-CN": "本群还没有启用 Asks。群主 / 管理员可发送 /linear settings 启用。",
    en: "Asks isn't enabled in this channel. A channel admin can enable it with /linear settings.",
  },
  "asks.usage": {
    "zh-CN": "用法：/ask 你的需求或问题（可附图片 / 文件）",
    en: "Usage: /ask <your request or question> (images / files can be attached)",
  },
  "asks.titleFallback": { "zh-CN": "{name} 的请求", en: "Request from {name}" },
  "asks.body": { "zh-CN": "**{name}** 通过飞书提交的请求：", en: "Request submitted by **{name}** via Feishu:" },

  // ── Issue 服务 ──
  "issue.notFound": { "zh-CN": "未找到 Issue {key}", en: "Issue {key} not found." },
  "issue.noTeam": { "zh-CN": "未找到可用的 Linear 团队", en: "No Linear team is available." },
  "issue.noTeamInWorkspace": { "zh-CN": "工作区里没有可用的团队", en: "There is no team in this workspace." },
  "issue.assigned.other": { "zh-CN": "已更新 {id} 的负责人", en: "Updated the assignee of {id}." },
  "issue.assigned.self": { "zh-CN": "已将 {id} 分配给你", en: "Assigned {id} to you." },
  "issue.subscribed": { "zh-CN": "已订阅 {id}", en: "Subscribed to {id}." },
  "issue.unsubscribed": { "zh-CN": "已取消订阅 {id}", en: "Unsubscribed from {id}." },
  "issue.commented": { "zh-CN": "已评论 {id}", en: "Commented on {id}." },
  "issue.attribution.footer": { "zh-CN": "由 {name} 通过飞书创建", en: "Created by {name} via Feishu" },
  "issue.attribution.prefix": { "zh-CN": "**{name}**（来自飞书）：", en: "**{name}** (via Feishu):" },
  "issue.attachmentsHeader": { "zh-CN": "来自飞书的附件：", en: "Attachments from Feishu:" },
  "issue.backlinkTitle": { "zh-CN": "飞书", en: "Feishu" },
  "issue.syncNotice": {
    "zh-CN":
      "🔗 已与 Linear {id} 建立同步：此话题里的回复会同步为 Issue 评论（含图片/文件），Issue 的评论与状态变更也会同步到这里。",
    en: "🔗 This thread is now synced with Linear {id}: replies here become issue comments (including images and files), and issue comments and status changes appear here.",
  },

  // ── 表单 / 交互反馈 ──
  "action.noAssignee": { "zh-CN": "没有选择负责人", en: "No assignee selected." },
  "action.assigneeNotBound": {
    "zh-CN": "所选同事还没有绑定 Linear 账号",
    en: "The selected person hasn't linked a Linear account yet.",
  },
  "action.fillComment": { "zh-CN": "请填写评论内容", en: "Please enter a comment." },
  "action.fillCommentPrompt": { "zh-CN": "请填写评论", en: "Please write your comment." },
  "action.syncFailed": { "zh-CN": "建立同步线程失败", en: "Failed to sync the thread." },
  "action.syncDone": { "zh-CN": "已建立同步线程", en: "Thread synced." },
  "action.fillForm": { "zh-CN": "请填写表单", en: "Please fill in the form." },
  "action.fillTitle": { "zh-CN": "请填写标题", en: "Please enter a title." },
  "action.fillIssueKey": { "zh-CN": "请填写 Issue 编号", en: "Please enter an issue key." },
  "action.assigneeNotBound2": {
    "zh-CN": "所选负责人还没有绑定 Linear 账号",
    en: "The selected assignee hasn't linked a Linear account yet.",
  },
  "action.creating": { "zh-CN": "正在创建 Issue…", en: "Creating issue…" },
  "action.linking": { "zh-CN": "正在关联…", en: "Linking…" },
  "action.label.create": { "zh-CN": "创建 Issue", en: "Create issue" },
  "action.label.link": { "zh-CN": "关联 Issue", en: "Link issue" },
  "action.failed": { "zh-CN": "{label}失败", en: "{label} failed" },
  "action.created.title": { "zh-CN": "✅ 已创建 {id}", en: "✅ Created {id}" },
  "action.created.synced": { "zh-CN": "已建立同步线程", en: "Thread synced." },
  "action.created.cardSent": { "zh-CN": "Issue 卡片已发到会话中。", en: "The issue card has been posted to the conversation." },
  "action.linked.title": { "zh-CN": "🔗 已关联 {id}", en: "🔗 Linked {id}" },
  "action.saved": { "zh-CN": "已保存", en: "Saved" },
  "action.cleared": { "zh-CN": "已清除", en: "Cleared" },
  "action.guidanceSaved": { "zh-CN": "指引已保存", en: "Guidance saved" },
  "action.pickTypeAndName": { "zh-CN": "请选择类型并填写名称", en: "Choose a type and enter a name." },
  "action.subscribedTo": { "zh-CN": "已订阅「{name}」", en: "Subscribed to “{name}”" },
  "action.removed": { "zh-CN": "已移除", en: "Removed" },
  "action.pickTeam": { "zh-CN": "请选择团队", en: "Please select a team." },
  "action.asksEnabled": { "zh-CN": "Asks 已启用", en: "Asks enabled" },
  "action.asksDisabled": { "zh-CN": "Asks 已停用", en: "Asks disabled" },
  "action.languageSet": { "zh-CN": "语言已更新", en: "Language updated" },
  "sub.notFound": { "zh-CN": "没有找到名为「{name}」的{type}", en: "No {type} named “{name}” was found." },

  // ── 消息内容占位 ──
  "content.card": { "zh-CN": "[卡片消息]", en: "[Card message]" },
  "content.merged": { "zh-CN": "[合并转发的消息]", en: "[Merged forward]" },
  "content.sticker": { "zh-CN": "[表情]", en: "[Sticker]" },
  "content.other": { "zh-CN": "[{type} 消息]", en: "[{type} message]" },
  "content.tooLarge": { "zh-CN": "> ⚠️ 附件 {name} 超过 20MB，未同步", en: "> ⚠️ Attachment {name} exceeds 20 MB and was not synced" },
  "content.uploadFailed": { "zh-CN": "> ⚠️ 附件 {name} 同步失败", en: "> ⚠️ Attachment {name} failed to sync" },
  "content.tooMany": { "zh-CN": "> ⚠️ 仅同步前 {max} 个附件", en: "> ⚠️ Only the first {max} attachments were synced" },
  "content.titleFallback": { "zh-CN": "来自飞书的消息", en: "Message from Feishu" },
} satisfies Catalog;
