import { LinearClient } from "@linear/sdk";
import type { Env } from "../config.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("linear");

let _client: LinearClient | null = null;

export function getLinearClient(config: Env): LinearClient {
  if (_client) return _client;
  _client = new LinearClient({ apiKey: config.LINEAR_API_KEY });
  log.info("Linear 客户端已初始化");
  return _client;
}

// ── Issue 操作 ──

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
  },
) {
  const result = await client.createIssue(input);
  const issue = await result.issue;
  if (!issue) throw new Error("Issue 创建失败");
  log.info({ id: issue.id, identifier: issue.identifier }, "Issue 已创建");
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
  },
) {
  const result = await client.updateIssue(issueId, input);
  return result;
}

export async function getIssue(client: LinearClient, issueId: string) {
  return client.issue(issueId);
}

export async function searchIssues(
  client: LinearClient,
  query: string,
  opts?: { teamId?: string; first?: number },
) {
  return client.searchIssues(query, { first: opts?.first ?? 10 });
}

// ── 评论操作 ──

export async function createComment(
  client: LinearClient,
  issueId: string,
  body: string,
) {
  const result = await client.createComment({ issueId, body });
  const comment = await result.comment;
  if (!comment) throw new Error("评论创建失败");
  log.info({ id: comment.id, issueId }, "评论已创建");
  return comment;
}

// ── 团队与项目查询 ──

export async function getTeams(client: LinearClient) {
  const teams = await client.teams();
  return teams.nodes;
}

export async function getTeam(client: LinearClient, teamId: string) {
  return client.team(teamId);
}

export async function getProjects(client: LinearClient, first = 50) {
  const projects = await client.projects({ first });
  return projects.nodes;
}

export async function getProject(client: LinearClient, projectId: string) {
  return client.project(projectId);
}

// ── 用户查询 ──

export async function getUsers(client: LinearClient) {
  const users = await client.users();
  return users.nodes;
}

export async function getViewer(client: LinearClient) {
  return client.viewer;
}

// ── 状态查询 ──

export async function getWorkflowStates(client: LinearClient, teamId: string) {
  const team = await client.team(teamId);
  const states = await team.states();
  return states.nodes;
}

// ── 标签查询 ──

export async function getLabels(client: LinearClient, teamId?: string) {
  if (teamId) {
    const team = await client.team(teamId);
    const labels = await team.labels();
    return labels.nodes;
  }
  const labels = await client.issueLabels();
  return labels.nodes;
}

// ── Webhook 管理 ──

export async function createWebhook(
  client: LinearClient,
  url: string,
  teamId?: string,
  resourceTypes = ["Issue", "Comment", "Project"],
) {
  const input: Record<string, unknown> = {
    url,
    resourceTypes,
    ...(teamId ? { teamId } : { allPublicTeams: true }),
  };
  return client.createWebhook(input as never);
}
