import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ── 用户映射：飞书用户 ↔ Linear 用户 ──
export const userMappings = pgTable("user_mappings", {
  id: serial("id").primaryKey(),
  feishuOpenId: text("feishu_open_id").notNull().unique(),
  feishuUnionId: text("feishu_union_id"),
  feishuName: text("feishu_name"),
  feishuEmail: text("feishu_email"),
  linearUserId: text("linear_user_id").notNull(),
  linearEmail: text("linear_email"),
  linearName: text("linear_name"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── Linear OAuth 令牌（actor=app）──
export const linearTokens = pgTable("linear_tokens", {
  id: serial("id").primaryKey(),
  organizationId: text("organization_id").notNull().unique(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: ts("expires_at"),
  scope: text("scope"),
  appUserId: text("app_user_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── 同步线程：飞书话题 ↔ Linear Issue ──
export const syncThreads = pgTable(
  "sync_threads",
  {
    id: serial("id").primaryKey(),
    feishuChatId: text("feishu_chat_id").notNull(),
    feishuThreadId: text("feishu_thread_id").notNull().unique(),
    feishuRootMsgId: text("feishu_root_msg_id").notNull(),
    linearIssueId: text("linear_issue_id").notNull(),
    linearIssueIdentifier: text("linear_issue_identifier"),
    linearIssueUrl: text("linear_issue_url"),
    linearAttachmentId: text("linear_attachment_id"),
    syncEnabled: boolean("sync_enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_sync_threads_linear").on(t.linearIssueId)],
);

// ── 同步评论：飞书消息 ↔ Linear Comment ──
export const syncComments = pgTable(
  "sync_comments",
  {
    id: serial("id").primaryKey(),
    syncThreadId: integer("sync_thread_id")
      .notNull()
      .references(() => syncThreads.id, { onDelete: "cascade" }),
    feishuMsgId: text("feishu_msg_id").notNull().unique(),
    linearCommentId: text("linear_comment_id").notNull().unique(),
    direction: text("direction", {
      enum: ["feishu_to_linear", "linear_to_feishu"],
    }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("idx_sync_comments_thread").on(t.syncThreadId)],
);

// ── 通知配置 ──
export const notificationConfigs = pgTable(
  "notification_configs",
  {
    id: serial("id").primaryKey(),
    type: text("type", {
      enum: ["team", "project", "initiative", "view", "personal"],
    }).notNull(),
    linearEntityId: text("linear_entity_id").notNull(),
    linearEntityName: text("linear_entity_name"),
    feishuChatId: text("feishu_chat_id"),
    feishuUserId: text("feishu_user_id"),
    onCreated: boolean("on_created").notNull().default(true),
    onUpdated: boolean("on_updated").notNull().default(true),
    onCompleted: boolean("on_completed").notNull().default(false),
    onComment: boolean("on_comment").notNull().default(true),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_notification_entity").on(t.linearEntityId)],
);

// ── 项目频道映射 ──
export const projectChannels = pgTable("project_channels", {
  id: serial("id").primaryKey(),
  linearProjectId: text("linear_project_id").notNull().unique(),
  linearProjectName: text("linear_project_name"),
  feishuChatId: text("feishu_chat_id").notNull().unique(),
  autoCreated: boolean("auto_created").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── Agent Guidance ──
export const agentGuidance = pgTable("agent_guidance", {
  id: serial("id").primaryKey(),
  feishuChatId: text("feishu_chat_id").notNull().unique(),
  guidance: text("guidance").notNull(),
  defaultTeamId: text("default_team_id"),
  defaultProjectId: text("default_project_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── 事件去重 ──
export const processedEvents = pgTable(
  "processed_events",
  {
    id: serial("id").primaryKey(),
    eventId: text("event_id").notNull().unique(),
    source: text("source", { enum: ["feishu", "linear"] }).notNull(),
    processedAt: ts("processed_at").notNull().defaultNow(),
  },
  (t) => [index("idx_processed_events_at").on(t.processedAt)],
);

// ── Issue 展开冷却（替代进程内存 Map，多实例 / Serverless 共享）──
export const issueExpansions = pgTable(
  "issue_expansions",
  {
    id: serial("id").primaryKey(),
    chatId: text("chat_id").notNull(),
    issueIdentifier: text("issue_identifier").notNull(),
    expandedAt: ts("expanded_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_issue_expansions").on(t.chatId, t.issueIdentifier),
  ],
);

// ── OAuth state（防 CSRF）──
export const oauthStates = pgTable("oauth_states", {
  id: serial("id").primaryKey(),
  state: text("state").notNull().unique(),
  createdAt: createdAt(),
});

// ── 全局设置（key/value）：工作区级 Agent Guidance、项目频道自动创建开关等 ──
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

// ── 群级设置：默认团队 / 项目 / 模板（Agent Guidance 的结构化部分在 agent_guidance）──
export const chatSettings = pgTable("chat_settings", {
  id: serial("id").primaryKey(),
  feishuChatId: text("feishu_chat_id").notNull().unique(),
  defaultTeamId: text("default_team_id"),
  defaultProjectId: text("default_project_id"),
  defaultTemplateId: text("default_template_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── 个人通知偏好（私聊推送哪些事件）──
export const userNotificationPrefs = pgTable("user_notification_prefs", {
  id: serial("id").primaryKey(),
  feishuOpenId: text("feishu_open_id").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  onAssigned: boolean("on_assigned").notNull().default(true),
  onMentioned: boolean("on_mentioned").notNull().default(true),
  onComment: boolean("on_comment").notNull().default(true),
  onStatusChange: boolean("on_status_change").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── 视图订阅：自定义 View 的 Issue 集合变化时推送到群 ──
export const viewSubscriptions = pgTable(
  "view_subscriptions",
  {
    id: serial("id").primaryKey(),
    linearViewId: text("linear_view_id").notNull(),
    linearViewName: text("linear_view_name"),
    feishuChatId: text("feishu_chat_id").notNull(),
    /** added = 新进入视图；completed = 完成；both */
    trigger: text("trigger", { enum: ["added", "completed", "both"] })
      .notNull()
      .default("added"),
    /** 上一次轮询的快照：issueId → 是否已完成 */
    snapshot: jsonb("snapshot").$type<Record<string, boolean>>(),
    snapshotAt: ts("snapshot_at"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("uq_view_sub").on(t.linearViewId, t.feishuChatId)],
);

// ── 重复关系：duplicate 被标记为重复，original 为原始 Issue ──
export const issueDuplicates = pgTable(
  "issue_duplicates",
  {
    id: serial("id").primaryKey(),
    duplicateIssueId: text("duplicate_issue_id").notNull(),
    originalIssueId: text("original_issue_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_issue_duplicates").on(t.duplicateIssueId, t.originalIssueId),
    index("idx_issue_duplicates_original").on(t.originalIssueId),
  ],
);
