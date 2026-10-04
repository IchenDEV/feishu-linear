/**
 * 部署所需的外部配置清单：`pnpm setup:check` 与文档共用同一份，避免漂移。
 */

/** 飞书应用权限（租户身份）。core 缺失会导致核心功能不可用；feature 缺失仅影响对应功能。 */
export const FEISHU_SCOPES = {
  core: [
    "im:message:send_as_bot",
    "im:message:readonly",
    "im:message:update",
    "im:message.p2p_msg:readonly",
    "im:message.group_at_msg:readonly",
    "im:chat:read",
    "im:resource",
    "contact:user.base:readonly",
    "contact:user.id:readonly",
    "contact:user.email:readonly",
  ],
  feature: {
    "im:message.group_msg": "Agent 读取群内近期消息作为上下文 / Agent reads recent channel messages for context",
    "im:message.reactions:write_only": "处理中的表情反馈 / Typing reaction while the agent works",
    "im:message.pins:write_only": "项目频道置顶简介 / Pin the project intro",
    "im:chat:create": "项目频道自动建群 / Create project channels",
    "im:chat:update": "项目改名同步群名 / Rename project channels",
    "im:chat.members:write_only": "项目频道邀请成员 / Invite members to project channels",
    "im:chat.managers:write_only": "设置群管理员 / Manage channel admins",
    "im:chat.tabs:write_only": "项目频道 Linear 标签页 / Linear tab in project channels",
    "im:chat.top_notice:write_only": "群置顶公告 / Channel top notice",
  } as Record<string, string>,
} as const;

/** 需要订阅的飞书回调（webhook 模式） */
export const FEISHU_CALLBACKS = {
  required: ["card.action.trigger"],
  optional: { "url.preview.get": "链接预览 / Link previews" } as Record<string, string>,
} as const;

/** 需要订阅的飞书事件（后台只能手动配置，无法通过 API 读取） */
export const FEISHU_EVENTS = ["im.message.receive_v1", "application.bot.menu_v6"] as const;

/** 机器人菜单的事件 key */
export const FEISHU_MENU_KEYS = ["create_issue", "my_notifications", "help"] as const;

/** 斜杠命令 */
export const SLASH_COMMANDS = [
  {
    command: "linear",
    description: {
      default_value: "Linear: create, link and sync issues",
      i18n: { zh_cn: "Linear：创建 / 关联 / 同步 Issue", en_us: "Linear: create, link and sync issues" },
    },
  },
  {
    command: "ask",
    description: {
      default_value: "Send a request to the team",
      i18n: { zh_cn: "向团队提需求", en_us: "Send a request to the team" },
    },
  },
] as const;

/** Linear webhook 需要勾选的资源类型 */
export const LINEAR_WEBHOOK_RESOURCES = [
  "Issue",
  "Comment",
  "Project",
  "ProjectUpdate",
  "Initiative",
  "InitiativeUpdate",
] as const;

/** 在开发者后台预填缺失权限的深链 */
export function scopeApplyUrl(appId: string, scopes: string[]): string {
  return `https://open.feishu.cn/app/${appId}/auth?q=${scopes.join(",")}&op_from=openapi&token_type=tenant`;
}
