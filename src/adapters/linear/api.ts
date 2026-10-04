import type { LinearClient } from "@linear/sdk";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("linear-api");

// ───────────────────────── Issue ─────────────────────────

export async function createIssue(
  client: LinearClient,
  input: {
    teamId: string;
    title: string;
    description?: string;
    assigneeId?: string;
    priority?: number;
    labelIds?: string[];
    projectId?: string;
    stateId?: string;
    templateId?: string;
    createAsUser?: string;
    displayIconUrl?: string;
  },
) {
  const result = await client.createIssue(input);
  const issue = await result.issue;
  if (!issue) throw new Error("Failed to create the issue");
  log.info({ id: issue.id, identifier: issue.identifier }, "Issue created");
  return issue;
}

export async function updateIssue(
  client: LinearClient,
  issueId: string,
  input: {
    title?: string;
    description?: string;
    assigneeId?: string | null;
    stateId?: string;
    priority?: number;
    labelIds?: string[];
    projectId?: string | null;
  },
) {
  return client.updateIssue(issueId, input);
}

/** 按 UUID 或 `ENG-123` 取 Issue（Linear 的 issue 查询原生支持标识符）；不存在返回 null */
export async function getIssue(client: LinearClient, idOrIdentifier: string) {
  try {
    return await client.issue(idOrIdentifier);
  } catch (err) {
    log.debug({ err, idOrIdentifier }, "Issue not found");
    return null;
  }
}

/** @deprecated 使用 getIssue */
export const getIssueByIdentifier = getIssue;

export async function searchIssues(
  client: LinearClient,
  query: string,
  first = 10,
) {
  return client.searchIssues(query, { first });
}

/** 按条件列 Issue（Agent / MCP 使用） */
export async function listIssues(
  client: LinearClient,
  opts: {
    teamId?: string;
    projectId?: string;
    assigneeId?: string;
    stateType?: string[];
    first?: number;
  } = {},
) {
  const filter: Record<string, unknown> = {};
  if (opts.teamId) filter.team = { id: { eq: opts.teamId } };
  if (opts.projectId) filter.project = { id: { eq: opts.projectId } };
  if (opts.assigneeId) filter.assignee = { id: { eq: opts.assigneeId } };
  if (opts.stateType?.length) filter.state = { type: { in: opts.stateType } };
  const res = await client.issues({
    first: opts.first ?? 25,
    filter,
    orderBy: "updatedAt" as never,
  });
  return res.nodes;
}

export async function createRelation(
  client: LinearClient,
  input: {
    issueId: string;
    relatedIssueId: string;
    type: "blocks" | "duplicate" | "related" | "similar";
  },
) {
  return client.createIssueRelation(input as never);
}

export async function subscribeIssue(client: LinearClient, issueId: string) {
  return client.issueSubscribe(issueId);
}

export async function unsubscribeIssue(client: LinearClient, issueId: string) {
  return client.issueUnsubscribe(issueId);
}

// ───────────────────────── Comment / Attachment ─────────────────────────

export async function createComment(
  client: LinearClient,
  input: {
    issueId: string;
    body: string;
    parentId?: string;
    createAsUser?: string;
    displayIconUrl?: string;
  },
) {
  const result = await client.createComment(input);
  const comment = await result.comment;
  if (!comment) throw new Error("Failed to create the comment");
  log.info({ id: comment.id, issueId: input.issueId }, "Comment created");
  return comment;
}

export async function linkUrlAttachment(
  client: LinearClient,
  issueId: string,
  url: string,
  title?: string,
) {
  return client.attachmentLinkURL(issueId, url, {
    title: title ?? "Feishu message",
  });
}

/**
 * 上传文件到 Linear 的资源存储，返回可在 Markdown 里引用的 assetUrl
 * （fileUpload 预签名 → PUT）
 */
export async function uploadFile(
  client: LinearClient,
  file: { data: Uint8Array; filename: string; contentType: string },
): Promise<string> {
  const payload = await client.fileUpload(
    file.contentType,
    file.filename,
    file.data.byteLength,
  );
  const upload = payload.uploadFile;
  if (!payload.success || !upload) throw new Error("Failed to initialize the Linear file upload");

  const headers: Record<string, string> = {
    "Content-Type": file.contentType,
    "Cache-Control": "public, max-age=31536000",
  };
  for (const h of upload.headers) headers[h.key] = h.value;

  const res = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers,
    body: file.data as unknown as BodyInit,
  });
  if (!res.ok) throw new Error(`Linear file upload failed: HTTP ${res.status}`);
  return upload.assetUrl;
}

// ───────────────────────── 目录数据 ─────────────────────────

export async function getTeams(client: LinearClient) {
  const teams = await client.teams();
  return teams.nodes;
}

export async function getProjects(client: LinearClient, first = 100) {
  const projects = await client.projects({ first });
  return projects.nodes;
}

export async function getProject(client: LinearClient, projectId: string) {
  return client.project(projectId);
}

export async function getInitiatives(client: LinearClient, first = 50) {
  const res = await client.initiatives({ first });
  return res.nodes;
}

export async function getInitiative(client: LinearClient, id: string) {
  return client.initiative(id);
}

export async function getDocument(client: LinearClient, id: string) {
  return client.document(id);
}

export async function getUsers(client: LinearClient) {
  const users = await client.users({ first: 250 });
  return users.nodes;
}

export async function getWorkflowStates(client: LinearClient, teamId: string) {
  const team = await client.team(teamId);
  const states = await team.states();
  return states.nodes;
}

export async function getLabels(client: LinearClient, teamId: string) {
  const team = await client.team(teamId);
  const labels = await team.labels({ first: 100 });
  return labels.nodes;
}

export async function findUserByEmail(client: LinearClient, email: string) {
  const users = await getUsers(client);
  return users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

export async function getOrganizationId(client: LinearClient) {
  const org = await client.organization;
  return org.id;
}

// ───────────────────────── 模板 / 视图 / 文档 ─────────────────────────

/** 可用的 Issue 模板（Slack 集成最多开放 10 个）；优先团队模板 */
export async function listIssueTemplates(
  client: LinearClient,
  teamId?: string,
  max = 10,
) {
  const templates = teamId
    ? await (await client.team(teamId)).templates()
    : await (await client.organization).templates();
  return templates.nodes.filter((t) => t.type === "issue").slice(0, max);
}

/** 团队默认 Issue 模板（若有） */
export async function getTeamDefaultTemplate(
  client: LinearClient,
  teamId: string,
) {
  const team = await client.team(teamId);
  return (await team.defaultTemplateForMembers) ?? null;
}

export async function listCustomViews(client: LinearClient, first = 100) {
  const res = await client.customViews({ first });
  return res.nodes;
}

export async function getCustomView(client: LinearClient, id: string) {
  return client.customView(id);
}

/** 视图当前匹配的 Issue（用于视图订阅轮询） */
export async function getViewIssues(
  client: LinearClient,
  viewId: string,
  first = 100,
) {
  const view = await client.customView(viewId);
  const res = await view.issues({ first });
  return res.nodes;
}

export async function createDocument(
  client: LinearClient,
  input: {
    title: string;
    content: string;
    projectId?: string;
    initiativeId?: string;
    issueId?: string;
    teamId?: string;
  },
) {
  const res = await client.createDocument(input);
  const doc = await res.document;
  if (!doc) throw new Error("Failed to create the document");
  return doc;
}

export async function getProjectMembers(
  client: LinearClient,
  projectId: string,
) {
  const project = await client.project(projectId);
  const members = await project.members({ first: 250 });
  return members.nodes;
}

export async function getProjectUpdates(
  client: LinearClient,
  projectId: string,
  first = 5,
) {
  const project = await client.project(projectId);
  const res = await project.projectUpdates({ first });
  return res.nodes;
}

export async function createReaction(
  client: LinearClient,
  commentId: string,
  emoji: string,
) {
  return client.createReaction({ commentId, emoji });
}

/** 创建 Issue 表单所需的团队级选项（项目 / 状态 / 标签 / 模板），并行拉取 */
export async function getTeamFormOptions(client: LinearClient, teamId: string) {
  const team = await client.team(teamId);
  const [projects, states, labels, templates] = await Promise.all([
    team.projects({ first: 100 }).then((r) => r.nodes),
    team.states().then((r) => r.nodes),
    team.labels({ first: 100 }).then((r) => r.nodes),
    team.templates().then((r) => r.nodes.filter((t) => t.type === "issue").slice(0, 10)),
  ]);
  return {
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
    states: states
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ id: s.id, name: s.name })),
    labels: labels.map((l) => ({ id: l.id, name: l.name })),
    templates: templates.map((t) => ({ id: t.id, name: t.name })),
  };
}
