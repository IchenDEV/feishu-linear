import type { LinearClient } from "@linear/sdk";
import type { AppContext } from "../../app/context.js";
import * as linearApi from "../../adapters/linear/api.js";
import { resolveChatDefaults } from "../settings/store.js";
import {
  requireLinearIdentity,
  getFeishuUserName,
} from "../users/mapping.js";
import { attribute } from "../issues/service.js";
import { uploadAttachmentsToLinear, type Attachment } from "../messages/content.js";
import { upgradeToSyncThread } from "../issues/service.js";

/** 工具运行环境：Agent 来自飞书会话；MCP 没有飞书用户 */
export interface ToolEnv {
  ctx: AppContext;
  /** 发起人（飞书）。有则写操作以其 Linear 账号为准，且必须已绑定 */
  openId?: string;
  chatId?: string;
  messageId?: string;
  threadId?: string;
  /** 本次对话上下文里的图片 / 文件，可随 create_issue 一并上传到 Linear */
  contextAttachments?: Attachment[];
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** 写操作（MCP 只读模式下会隐藏） */
  write?: boolean;
  run: (env: ToolEnv, args: Record<string, any>) => Promise<unknown>;
}

const str = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
});

// ───────────────────────── 名称解析 ─────────────────────────

const eq = (a?: string | null, b?: string | null) =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
const has = (a?: string | null, b?: string | null) =>
  Boolean(a && b && a.toLowerCase().includes(b.trim().toLowerCase()));

async function resolveTeam(env: ToolEnv, linear: LinearClient, nameOrKey?: string) {
  const teams = await linearApi.getTeams(linear);
  if (nameOrKey) {
    const t =
      teams.find((x) => eq(x.key, nameOrKey) || eq(x.name, nameOrKey)) ??
      teams.find((x) => has(x.name, nameOrKey));
    if (!t) throw new Error(`Team "${nameOrKey}" not found. Available: ${teams.map((x) => `${x.name}(${x.key})`).join(", ")}`);
    return t;
  }
  if (env.chatId) {
    const d = await resolveChatDefaults(env.ctx, env.chatId);
    const t = teams.find((x) => x.id === d.teamId);
    if (t) return t;
  }
  if (!teams[0]) throw new Error("The workspace has no teams");
  return teams[0];
}

async function resolveProjectId(env: ToolEnv, linear: LinearClient, name?: string) {
  if (!name) {
    if (!env.chatId) return undefined;
    return (await resolveChatDefaults(env.ctx, env.chatId)).projectId;
  }
  const projects = await linearApi.getProjects(linear);
  const p = projects.find((x) => eq(x.name, name)) ?? projects.find((x) => has(x.name, name));
  if (!p) throw new Error(`Project "${name}" not found`);
  return p.id;
}

async function resolveUserId(env: ToolEnv, linear: LinearClient, who?: string) {
  if (!who) return undefined;
  if (/^(me|self|myself|我|自己)$/i.test(who.trim())) {
    if (!env.openId) throw new Error('Cannot resolve "me": there is no linked user for this request');
    return (await requireLinearIdentity(env.ctx, env.openId)).linearUserId;
  }
  const users = await linearApi.getUsers(linear);
  const u =
    users.find((x) => eq(x.email, who) || eq(x.name, who) || eq(x.displayName, who)) ??
    users.find((x) => has(x.name, who) || has(x.displayName, who));
  if (!u) throw new Error(`User "${who}" not found`);
  return u.id;
}

async function resolveState(linear: LinearClient, teamId: string, name?: string) {
  if (!name) return undefined;
  const states = await linearApi.getWorkflowStates(linear, teamId);
  const s = states.find((x) => eq(x.name, name)) ?? states.find((x) => has(x.name, name));
  if (!s) throw new Error(`Status "${name}" not found. Available: ${states.map((x) => x.name).join(", ")}`);
  return s.id;
}

async function resolveLabelIds(linear: LinearClient, teamId: string, names?: string[]) {
  if (!names?.length) return undefined;
  const labels = await linearApi.getLabels(linear, teamId);
  return names.map((n) => {
    const l = labels.find((x) => eq(x.name, n)) ?? labels.find((x) => has(x.name, n));
    if (!l) throw new Error(`Label "${n}" not found`);
    return l.id;
  });
}

async function writer(env: ToolEnv) {
  if (!env.openId) return { name: "", who: attribute(env.ctx, ""), identity: null };
  const identity = await requireLinearIdentity(env.ctx, env.openId);
  const name = await getFeishuUserName(env.ctx, env.openId, identity.linearName ?? "Feishu user");
  return { name, who: attribute(env.ctx, name), identity };
}

async function summarize(issue: NonNullable<Awaited<ReturnType<typeof linearApi.getIssue>>>) {
  const [state, assignee, team, project, labels] = await Promise.all([
    issue.state,
    issue.assignee,
    issue.team,
    issue.project,
    issue.labels().then((l) => l.nodes.map((x) => x.name)),
  ]);
  return {
    identifier: issue.identifier,
    title: issue.title,
    status: state?.name,
    assignee: assignee?.name ?? null,
    priority: ["None", "Urgent", "High", "Medium", "Low"][issue.priority] ?? issue.priority,
    team: team?.name,
    project: project?.name ?? null,
    labels,
    dueDate: issue.dueDate ?? null,
    url: issue.url,
  };
}

async function getIssueOrThrow(linear: LinearClient, key: string) {
  const k = key.match(/([A-Za-z][A-Za-z0-9]*-\d+)/)?.[1]?.toUpperCase() ?? key;
  const issue = await linearApi.getIssue(linear, k);
  if (!issue) throw new Error(`Issue ${key} not found`);
  return issue;
}

// ───────────────────────── 工具定义 ─────────────────────────

export const linearTools: ToolDef[] = [
  {
    name: "search_issues",
    description: "Full-text search for issues",
    parameters: obj({ query: str("Search keywords"), limit: { type: "number" } }, ["query"]),
    run: async ({ ctx }, a) => {
      const linear = await ctx.getLinear();
      const res = await linearApi.searchIssues(linear, a.query, Math.min(a.limit ?? 8, 20));
      const full = await Promise.all(res.nodes.map((i) => linearApi.getIssue(linear, i.id)));
      return Promise.all(full.filter((i): i is NonNullable<typeof i> => Boolean(i)).map((i) => summarize(i)));
    },
  },
  {
    name: "list_issues",
    description: "List issues by team / project / assignee / status type, most recently updated first",
    parameters: obj({
      team: str("Team name or key"),
      project: str("Project name"),
      assignee: str('Assignee: name or email, or "me"'),
      stateTypes: {
        type: "array",
        items: { type: "string", enum: ["triage", "backlog", "unstarted", "started", "completed", "canceled"] },
      },
      limit: { type: "number" },
    }),
    run: async (env, a) => {
      const linear = await env.ctx.getLinear();
      const issues = await linearApi.listIssues(linear, {
        teamId: a.team ? (await resolveTeam(env, linear, a.team)).id : undefined,
        projectId: a.project ? await resolveProjectId(env, linear, a.project) : undefined,
        assigneeId: await resolveUserId(env, linear, a.assignee),
        stateType: a.stateTypes,
        first: Math.min(a.limit ?? 15, 50),
      });
      return Promise.all(issues.map((i) => summarize(i)));
    },
  },
  {
    name: "get_issue",
    description: "Get issue details, including the description and recent comments",
    parameters: obj({ issue: str("Issue key such as ENG-123, or a URL") }, ["issue"]),
    run: async ({ ctx }, a) => {
      const linear = await ctx.getLinear();
      const issue = await getIssueOrThrow(linear, a.issue);
      const comments = (await issue.comments({ first: 5 })).nodes;
      return {
        ...(await summarize(issue)),
        description: issue.description?.slice(0, 2000) ?? null,
        recentComments: await Promise.all(
          comments.map(async (c) => ({ by: (await c.user)?.name, body: c.body.slice(0, 500) })),
        ),
      };
    },
  },
  {
    name: "create_issue",
    description:
      "Create an issue. Uses the channel defaults when team/project are omitted. attachContextFiles=true uploads images/files from the current conversation to the issue.",
    write: true,
    parameters: obj(
      {
        title: str("Title"),
        description: str("Description (Markdown)"),
        team: str("Team name or key"),
        project: str("Project name"),
        assignee: str('Assignee: name or email, or "me"'),
        priority: { type: "number", enum: [0, 1, 2, 3, 4], description: "1=Urgent 4=Low" },
        status: str("Status name"),
        labels: { type: "array", items: { type: "string" } },
        template: str("Template name (optional)"),
        dueDate: str("Due date, YYYY-MM-DD"),
        attachContextFiles: { type: "boolean" },
        syncThread: { type: "boolean", description: "After creating, sync the current Feishu thread with the issue" },
      },
      ["title"],
    ),
    run: (env, a) => createIssueTool(env, a),
  },
];

async function createIssueTool(env: ToolEnv, a: Record<string, any>) {
  const { ctx } = env;
  const linear = await ctx.getLinear();
  const w = await writer(env);
  const team = await resolveTeam(env, linear, a.team);
  const defaults = env.chatId ? await resolveChatDefaults(ctx, env.chatId) : {};

  let templateId: string | undefined;
  if (a.template) {
    const t = (await linearApi.listIssueTemplates(linear, team.id, 50)).find(
      (x) => eq(x.name, a.template) || has(x.name, a.template),
    );
    templateId = t?.id;
  } else {
    templateId =
      (defaults as { templateId?: string }).templateId ??
      (await linearApi.getTeamDefaultTemplate(linear, team.id))?.id;
  }

  const att =
    a.attachContextFiles && env.contextAttachments?.length
      ? await uploadAttachmentsToLinear(ctx, env.contextAttachments)
      : [];
  const description = [a.description, ...att].filter(Boolean).join("\n\n") + w.who.footer;

  const issue = await linearApi.createIssue(linear, {
    teamId: team.id,
    title: String(a.title).slice(0, 250),
    description: description.trim() || undefined,
    assigneeId: a.assignee ? await resolveUserId(env, linear, a.assignee) : undefined,
    priority: a.priority,
    projectId: (await resolveProjectId(env, linear, a.project)) ?? undefined,
    stateId: await resolveState(linear, team.id, a.status),
    labelIds: await resolveLabelIds(linear, team.id, a.labels),
    templateId,
    createAsUser: w.who.createAsUser,
  });
  if (a.dueDate) await linear.updateIssue(issue.id, { dueDate: a.dueDate });

  let synced = false;
  if (a.syncThread && env.chatId && env.messageId) {
    synced = Boolean(
      await upgradeToSyncThread(ctx, {
        issue,
        chatId: env.chatId,
        messageId: env.messageId,
        threadId: env.threadId,
      }),
    );
  }
  return { ...(await summarize(issue)), synced };
}

linearTools.push(
  {
    name: "update_issue",
    description: "Update an issue's title, description, status, assignee, priority, labels, project or due date",
    write: true,
    parameters: obj(
      {
        issue: str("Issue key or URL"),
        title: str("New title"),
        description: str("New description (replaces the existing one)"),
        status: str("Status name"),
        assignee: str('Assignee: name or email, "me", or "none" to unassign'),
        priority: { type: "number", enum: [0, 1, 2, 3, 4] },
        labels: { type: "array", items: { type: "string" }, description: "Complete list of labels (replaces existing labels)" },
        project: str('Project name, or "none" to remove from the project'),
        dueDate: str("YYYY-MM-DD"),
      },
      ["issue"],
    ),
    run: async (env, a) => {
      const linear = await env.ctx.getLinear();
      await writer(env);
      const issue = await getIssueOrThrow(linear, a.issue);
      const team = await issue.team;
      if (!team) throw new Error("The issue has no team");
      const patch: Record<string, unknown> = {};
      if (a.title) patch.title = a.title;
      if (a.description) patch.description = a.description;
      if (a.status) patch.stateId = await resolveState(linear, team.id, a.status);
      if (a.assignee) {
        patch.assigneeId = /^(none|unassign|无|取消)$/i.test(a.assignee)
          ? null
          : await resolveUserId(env, linear, a.assignee);
      }
      if (a.priority !== undefined) patch.priority = a.priority;
      if (a.labels) patch.labelIds = await resolveLabelIds(linear, team.id, a.labels);
      if (a.project) {
        patch.projectId = /^(none|无)$/i.test(a.project)
          ? null
          : await resolveProjectId(env, linear, a.project);
      }
      if (a.dueDate) patch.dueDate = a.dueDate;
      await linear.updateIssue(issue.id, patch as never);
      const fresh = await linearApi.getIssue(linear, issue.id);
      return fresh ? summarize(fresh) : { updated: true };
    },
  },
  {
    name: "comment_on_issue",
    description: "Post a comment on an issue",
    write: true,
    parameters: obj({ issue: str("Issue key or URL"), body: str("Comment body (Markdown)") }, ["issue", "body"]),
    run: async (env, a) => {
      const linear = await env.ctx.getLinear();
      const w = await writer(env);
      const issue = await getIssueOrThrow(linear, a.issue);
      await linearApi.createComment(linear, {
        issueId: issue.id,
        body: w.who.prefix + a.body,
        createAsUser: w.who.createAsUser,
      });
      return { commented: issue.identifier, url: issue.url };
    },
  },
  {
    name: "relate_issues",
    description: "Create an issue relation: blocks / related / duplicate (issue is a duplicate of relatedIssue)",
    write: true,
    parameters: obj(
      {
        issue: str("Issue key"),
        relatedIssue: str("Issue key"),
        type: { type: "string", enum: ["blocks", "related", "duplicate"] },
      },
      ["issue", "relatedIssue", "type"],
    ),
    run: async (env, a) => {
      const linear = await env.ctx.getLinear();
      await writer(env);
      const [x, y] = await Promise.all([
        getIssueOrThrow(linear, a.issue),
        getIssueOrThrow(linear, a.relatedIssue),
      ]);
      await linearApi.createRelation(linear, {
        issueId: x.id,
        relatedIssueId: y.id,
        type: a.type,
      });
      return { related: [x.identifier, y.identifier], type: a.type };
    },
  },
  {
    name: "subscribe_issue",
    description: "Subscribe the requester to / unsubscribe the requester from an issue",
    write: true,
    parameters: obj({ issue: str("Issue key"), subscribe: { type: "boolean" } }, ["issue"]),
    run: async (env, a) => {
      if (!env.openId) throw new Error("A Feishu user identity is required");
      const { setIssueSubscription } = await import("../issues/service.js");
      return setIssueSubscription(env.ctx, {
        issueKey: a.issue,
        operatorOpenId: env.openId,
        subscribe: a.subscribe !== false,
      });
    },
  },
  {
    name: "list_teams",
    description: "List teams",
    parameters: obj({}),
    run: async ({ ctx }) =>
      (await linearApi.getTeams(await ctx.getLinear())).map((t) => ({ name: t.name, key: t.key })),
  },
  {
    name: "list_projects",
    description: "List projects",
    parameters: obj({ team: str("Team name or key (optional)") }),
    run: async (env) => {
      const linear = await env.ctx.getLinear();
      const projects = await linearApi.getProjects(linear, 100);
      return projects.map((p) => ({ name: p.name, status: String(p.state ?? ""), url: p.url }));
    },
  },
  {
    name: "list_workflow_states",
    description: "List the workflow states of a team",
    parameters: obj({ team: str("Team name or key") }),
    run: async (env, a) => {
      const linear = await env.ctx.getLinear();
      const team = await resolveTeam(env, linear, a.team);
      return (await linearApi.getWorkflowStates(linear, team.id)).map((s) => ({ name: s.name, type: s.type }));
    },
  },
  {
    name: "list_labels",
    description: "List the labels of a team",
    parameters: obj({ team: str("Team name or key") }),
    run: async (env, a) => {
      const linear = await env.ctx.getLinear();
      const team = await resolveTeam(env, linear, a.team);
      return (await linearApi.getLabels(linear, team.id)).map((l) => l.name);
    },
  },
  {
    name: "list_users",
    description: "List or search workspace members",
    parameters: obj({ query: str("Name or email keyword (optional)") }),
    run: async ({ ctx }, a) => {
      const users = await linearApi.getUsers(await ctx.getLinear());
      return users
        .filter((u) => u.active && (!a.query || has(u.name, a.query) || has(u.email, a.query)))
        .slice(0, 30)
        .map((u) => ({ name: u.name, email: u.email }));
    },
  },
  {
    name: "list_initiatives",
    description: "List initiatives",
    parameters: obj({}),
    run: async ({ ctx }) =>
      (await linearApi.getInitiatives(await ctx.getLinear())).map((i) => ({
        name: i.name,
        status: String(i.status ?? ""),
        url: i.url,
      })),
  },
  {
    name: "list_issue_templates",
    description: "List the issue templates available to a team (up to 10)",
    parameters: obj({ team: str("Team name or key") }),
    run: async (env, a) => {
      const linear = await env.ctx.getLinear();
      const team = await resolveTeam(env, linear, a.team);
      return (await linearApi.listIssueTemplates(linear, team.id, 10)).map((t) => t.name);
    },
  },
  {
    name: "get_project",
    description: "Get project details and recent project updates",
    parameters: obj({ project: str("Project name") }, ["project"]),
    run: async (env, a) => {
      const linear = await env.ctx.getLinear();
      const id = await resolveProjectId(env, linear, a.project);
      if (!id) throw new Error("Project not found");
      const p = await linearApi.getProject(linear, id);
      const updates = await linearApi.getProjectUpdates(linear, id, 3);
      return {
        name: p.name,
        status: String(p.state ?? ""),
        progress: p.progress,
        targetDate: p.targetDate,
        lead: (await p.lead)?.name,
        description: p.description?.slice(0, 1000),
        url: p.url,
        recentUpdates: updates.map((u) => ({ health: u.health, body: u.body.slice(0, 400) })),
      };
    },
  },
  {
    name: "create_document",
    description: "Create a Linear document (optionally attached to a project or an issue)",
    write: true,
    parameters: obj(
      { title: str("Title"), content: str("Markdown content"), project: str("Project name"), issue: str("Issue key") },
      ["title", "content"],
    ),
    run: async (env, a) => {
      const linear = await env.ctx.getLinear();
      await writer(env);
      const doc = await linearApi.createDocument(linear, {
        title: a.title,
        content: a.content,
        projectId: a.project ? await resolveProjectId(env, linear, a.project) : undefined,
        issueId: a.issue ? (await getIssueOrThrow(linear, a.issue)).id : undefined,
      });
      return { title: doc.title, url: doc.url };
    },
  },
);
