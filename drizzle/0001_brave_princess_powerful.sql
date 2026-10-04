CREATE TABLE IF NOT EXISTS "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"feishu_chat_id" text NOT NULL,
	"default_team_id" text,
	"default_project_id" text,
	"default_template_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_settings_feishu_chat_id_unique" UNIQUE("feishu_chat_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issue_duplicates" (
	"id" serial PRIMARY KEY NOT NULL,
	"duplicate_issue_id" text NOT NULL,
	"original_issue_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_notification_prefs" (
	"id" serial PRIMARY KEY NOT NULL,
	"feishu_open_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"on_assigned" boolean DEFAULT true NOT NULL,
	"on_mentioned" boolean DEFAULT true NOT NULL,
	"on_comment" boolean DEFAULT true NOT NULL,
	"on_status_change" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_notification_prefs_feishu_open_id_unique" UNIQUE("feishu_open_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "view_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"linear_view_id" text NOT NULL,
	"linear_view_name" text,
	"feishu_chat_id" text NOT NULL,
	"trigger" text DEFAULT 'added' NOT NULL,
	"snapshot" jsonb,
	"snapshot_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_issue_duplicates" ON "issue_duplicates" USING btree ("duplicate_issue_id","original_issue_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_issue_duplicates_original" ON "issue_duplicates" USING btree ("original_issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_view_sub" ON "view_subscriptions" USING btree ("linear_view_id","feishu_chat_id");