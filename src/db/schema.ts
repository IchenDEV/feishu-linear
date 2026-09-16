import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// ── 用户映射：飞书用户 ↔ Linear 用户 ──
export const userMappings = sqliteTable("user_mappings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  feishuOpenId: text("feishu_open_id").notNull().unique(),
  feishuUnionId: text("feishu_union_id"),
  feishuName: text("feishu_name"),
  linearUserId: text("linear_user_id").notNull(),
  linearEmail: text("linear_email"),
  linearName: text("linear_name"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ── 同步线程：飞书话题 ↔ Linear Issue ──
export const syncThreads = sqliteTable("sync_threads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  feishuChatId: text("feishu_chat_id").notNull(),
  feishuThreadId: text("feishu_thread_id").notNull().unique(),
  feishuRootMsgId: text("feishu_root_msg_id").notNull(),
  linearIssueId: text("linear_issue_id").notNull(),
  linearIssueIdentifier: text("linear_issue_identifier"), // e.g. "ENG-482"
  linearIssueUrl: text("linear_issue_url"),
  syncEnabled: integer("sync_enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ── 同步评论：飞书消息 ↔ Linear Comment ──
export const syncComments = sqliteTable("sync_comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  syncThreadId: integer("sync_thread_id").notNull(),
  feishuMsgId: text("feishu_msg_id").notNull(),
  linearCommentId: text("linear_comment_id").notNull(),
  direction: text("direction", { enum: ["feishu_to_linear", "linear_to_feishu"] }).notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ── 通知配置：团队/项目/视图 → 飞书群 ──
export const notificationConfigs = sqliteTable("notification_configs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", {
    enum: ["team", "project", "initiative", "view", "personal"],
  }).notNull(),
  // Linear 侧 ID
  linearEntityId: text("linear_entity_id").notNull(),
  linearEntityName: text("linear_entity_name"),
  // 飞书侧
  feishuChatId: text("feishu_chat_id"), // 群 ID（personal 类型为空）
  feishuUserId: text("feishu_user_id"), // 用户 ID（仅 personal 类型）
  // 通知触发条件
  onCreated: integer("on_created", { mode: "boolean" }).notNull().default(true),
  onUpdated: integer("on_updated", { mode: "boolean" }).notNull().default(true),
  onCompleted: integer("on_completed", { mode: "boolean" }).notNull().default(false),
  onComment: integer("on_comment", { mode: "boolean" }).notNull().default(true),
  // 元数据
  createdBy: text("created_by"), // 配置者的飞书 open_id
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ── 项目频道映射：Linear Project ↔ 飞书群 ──
export const projectChannels = sqliteTable("project_channels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  linearProjectId: text("linear_project_id").notNull().unique(),
  linearProjectName: text("linear_project_name"),
  feishuChatId: text("feishu_chat_id").notNull().unique(),
  autoCreated: integer("auto_created", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ── Agent 引导配置 ──
export const agentGuidance = sqliteTable("agent_guidance", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  feishuChatId: text("feishu_chat_id").notNull().unique(),
  guidance: text("guidance").notNull(), // 管理员写的 guidance 文本
  defaultTeamId: text("default_team_id"),
  defaultProjectId: text("default_project_id"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ── 事件去重表 ──
export const processedEvents = sqliteTable("processed_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: text("event_id").notNull().unique(),
  source: text("source", { enum: ["feishu", "linear"] }).notNull(),
  processedAt: text("processed_at").notNull().$defaultFn(() => new Date().toISOString()),
});
