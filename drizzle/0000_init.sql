CREATE TABLE IF NOT EXISTS "agent_guidance" (
	"id" serial PRIMARY KEY NOT NULL,
	"feishu_chat_id" text NOT NULL,
	"guidance" text NOT NULL,
	"default_team_id" text,
	"default_project_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_guidance_feishu_chat_id_unique" UNIQUE("feishu_chat_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issue_expansions" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"issue_identifier" text NOT NULL,
	"expanded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "linear_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"scope" text,
	"app_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "linear_tokens_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"linear_entity_id" text NOT NULL,
	"linear_entity_name" text,
	"feishu_chat_id" text,
	"feishu_user_id" text,
	"on_created" boolean DEFAULT true NOT NULL,
	"on_updated" boolean DEFAULT true NOT NULL,
	"on_completed" boolean DEFAULT false NOT NULL,
	"on_comment" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_states" (
	"id" serial PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_states_state_unique" UNIQUE("state")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "processed_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"source" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"linear_project_id" text NOT NULL,
	"linear_project_name" text,
	"feishu_chat_id" text NOT NULL,
	"auto_created" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_channels_linear_project_id_unique" UNIQUE("linear_project_id"),
	CONSTRAINT "project_channels_feishu_chat_id_unique" UNIQUE("feishu_chat_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"sync_thread_id" integer NOT NULL,
	"feishu_msg_id" text NOT NULL,
	"linear_comment_id" text NOT NULL,
	"direction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_comments_feishu_msg_id_unique" UNIQUE("feishu_msg_id"),
	CONSTRAINT "sync_comments_linear_comment_id_unique" UNIQUE("linear_comment_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"feishu_chat_id" text NOT NULL,
	"feishu_thread_id" text NOT NULL,
	"feishu_root_msg_id" text NOT NULL,
	"linear_issue_id" text NOT NULL,
	"linear_issue_identifier" text,
	"linear_issue_url" text,
	"linear_attachment_id" text,
	"sync_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_threads_feishu_thread_id_unique" UNIQUE("feishu_thread_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"feishu_open_id" text NOT NULL,
	"feishu_union_id" text,
	"feishu_name" text,
	"feishu_email" text,
	"linear_user_id" text NOT NULL,
	"linear_email" text,
	"linear_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_mappings_feishu_open_id_unique" UNIQUE("feishu_open_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sync_comments" ADD CONSTRAINT "sync_comments_sync_thread_id_sync_threads_id_fk" FOREIGN KEY ("sync_thread_id") REFERENCES "public"."sync_threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_issue_expansions" ON "issue_expansions" USING btree ("chat_id","issue_identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_entity" ON "notification_configs" USING btree ("linear_entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_processed_events_at" ON "processed_events" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sync_comments_thread" ON "sync_comments" USING btree ("sync_thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sync_threads_linear" ON "sync_threads" USING btree ("linear_issue_id");