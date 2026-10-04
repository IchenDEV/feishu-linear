import type { Catalog } from "./types.js";

/** 设置卡片、个人偏好卡片、权限提示 */
export const settings = {
  "settings.title": { "zh-CN": "⚙️ Linear 连接器设置", en: "⚙️ Linear connector settings" },

  "settings.defaults.heading": {
    "zh-CN": "**① 本群默认值**（建 Issue / 智能体推断项目时使用）",
    en: "**① Channel defaults** (used when creating issues and by the agent to infer team/project)",
  },
  "settings.defaults.team": { "zh-CN": "默认团队", en: "Default team" },
  "settings.defaults.project": { "zh-CN": "默认项目", en: "Default project" },
  "settings.defaults.template": {
    "zh-CN": "默认模板（属于默认团队）",
    en: "Default template (from the default team)",
  },
  "settings.defaults.save": { "zh-CN": "保存默认值", en: "Save defaults" },
  "settings.defaults.clear": { "zh-CN": "清除", en: "Clear" },

  "settings.guidance.heading": {
    "zh-CN": "**② 智能体指引（Guidance）**",
    en: "**② Agent guidance**",
  },
  "settings.guidance.placeholder": {
    "zh-CN": "对本群智能体的补充要求，例如：Bug 一律放进 Triage、优先级默认 Medium…",
    en: "Extra instructions for the agent in this channel, e.g. “Put all bugs in Triage, default priority Medium…”",
  },
  "settings.guidance.saveChat": { "zh-CN": "保存本群指引", en: "Save channel guidance" },
  "settings.guidance.saveWorkspace": { "zh-CN": "保存为工作区指引", en: "Save as workspace guidance" },
  "settings.guidance.current": {
    "zh-CN": "当前工作区指引：{text}",
    en: "Current workspace guidance: {text}",
  },

  "settings.subs.heading": {
    "zh-CN": "**③ 本群订阅的 Linear 通知**",
    en: "**③ Linear notifications for this channel**",
  },
  "settings.subs.empty": {
    "zh-CN": "还没有订阅。下面添加一个。",
    en: "No subscriptions yet. Add one below.",
  },
  "settings.subs.remove": { "zh-CN": "移除", en: "Remove" },
  "settings.subs.type": { "zh-CN": "订阅类型", en: "Subscription type" },
  "settings.subs.type.team": { "zh-CN": "团队（填团队名或 key）", en: "Team (name or key)" },
  "settings.subs.type.project": { "zh-CN": "项目", en: "Project" },
  "settings.subs.type.initiative": { "zh-CN": "Initiative", en: "Initiative" },
  "settings.subs.type.view": { "zh-CN": "视图（自定义 View）", en: "Custom view" },
  "settings.subs.name": {
    "zh-CN": "名称，如 Engineering / 官网改版 / 我的紧急 Bug",
    en: "Name, e.g. Engineering / Website redesign / My urgent bugs",
  },
  "settings.subs.triggers": {
    "zh-CN": "触发事件（视图：选 新进入/完成/二者）",
    en: "Events (for views: entered / completed / both)",
  },
  "settings.subs.trigger.created": { "zh-CN": "新建 Issue / 新进入视图", en: "Issue created / entered view" },
  "settings.subs.trigger.updated": { "zh-CN": "状态等更新", en: "Status and other updates" },
  "settings.subs.trigger.completed": { "zh-CN": "完成或取消", en: "Completed or canceled" },
  "settings.subs.trigger.comment": { "zh-CN": "新评论", en: "New comments" },
  "settings.subs.add": { "zh-CN": "添加订阅", en: "Add subscription" },
  "settings.subs.label.created": { "zh-CN": "新建", en: "created" },
  "settings.subs.label.updated": { "zh-CN": "更新", en: "updated" },
  "settings.subs.label.completed": { "zh-CN": "完成", en: "completed" },
  "settings.subs.label.comment": { "zh-CN": "评论", en: "comments" },
  "settings.subs.label.viewBoth": { "zh-CN": "新进入/完成", en: "entered/completed" },
  "settings.subs.label.viewAdded": { "zh-CN": "新进入", en: "entered" },
  "settings.subs.label.viewDone": { "zh-CN": "完成", en: "completed" },
  "settings.subs.kind.team": { "zh-CN": "团队", en: "Team" },
  "settings.subs.kind.project": { "zh-CN": "项目", en: "Project" },
  "settings.subs.kind.initiative": { "zh-CN": "Initiative", en: "Initiative" },
  "settings.subs.kind.view": { "zh-CN": "视图", en: "View" },

  "settings.asks.heading": {
    "zh-CN": "**④ Asks：让不在 Linear 的同事也能提需求**",
    en: "**④ Asks: let people without a Linear account submit requests**",
  },
  "settings.asks.enabled": {
    "zh-CN": "已启用：在本群发送 `/ask 内容`，会在团队「{team}」创建 Issue 并同步进展。",
    en: "Enabled: send `/ask <request>` in this channel to create an issue in team “{team}” and follow its progress.",
  },
  "settings.asks.disable": { "zh-CN": "停用", en: "Disable" },
  "settings.asks.team": { "zh-CN": "接收需求的团队", en: "Team that receives requests" },
  "settings.asks.enable": { "zh-CN": "启用 Asks", en: "Enable Asks" },

  "settings.workspace.heading": {
    "zh-CN": "**⑤ 工作区设置（仅 Linear 管理员）**",
    en: "**⑤ Workspace settings (Linear admins only)**",
  },
  "settings.workspace.autoChannels": {
    "zh-CN": "新项目自动建群：{state}",
    en: "Auto-create project channels: {state}",
  },
  "settings.workspace.privateChannels": {
    "zh-CN": "项目群为私有群：{state}",
    en: "Project channels are private: {state}",
  },
  "settings.on": { "zh-CN": "开", en: "on" },
  "settings.off": { "zh-CN": "关", en: "off" },
  "settings.yes": { "zh-CN": "是", en: "yes" },
  "settings.no": { "zh-CN": "否", en: "no" },

  "settings.language.heading": { "zh-CN": "**⑥ 界面语言**", en: "**⑥ Language**" },
  "settings.language.chat": {
    "zh-CN": "本群：{current}（个人设置优先于本群设置）",
    en: "This channel: {current} (personal language takes precedence)",
  },
  "settings.language.workspace": { "zh-CN": "工作区默认：{lang}", en: "Workspace default: {lang}" },
  "settings.language.auto": { "zh-CN": "跟随工作区", en: "Workspace default" },
  "locale.zh-CN": { "zh-CN": "简体中文", en: "简体中文" },
  "locale.en": { "zh-CN": "English", en: "English" },

  // ── 个人偏好 ──
  "prefs.title": { "zh-CN": "🔔 我的 Linear 通知", en: "🔔 My Linear notifications" },
  "prefs.intro": {
    "zh-CN": "机器人会把与你相关的 Linear 动态私聊推给你。点击切换：",
    en: "The bot sends you direct messages for Linear activity that concerns you. Tap to toggle:",
  },
  "prefs.master": { "zh-CN": "总开关", en: "All notifications" },
  "prefs.assigned": { "zh-CN": "分配给我", en: "Assigned to me" },
  "prefs.mentioned": { "zh-CN": "@ 提及我", en: "Mentions of me" },
  "prefs.comment": { "zh-CN": "我关注的 Issue 有评论", en: "Comments on issues I follow" },
  "prefs.status": { "zh-CN": "状态变更", en: "Status changes" },
  "prefs.language": { "zh-CN": "界面语言：", en: "Language:" },

  // ── 权限 ──
  "error.forbidden": {
    "zh-CN": "仅群主 / 群管理员 / Linear 管理员可以修改此设置",
    en: "Only the channel owner, channel admins or Linear admins can change this setting.",
  },
} satisfies Catalog;
