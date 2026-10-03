import type { LinearClient } from "@linear/sdk";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("linear-api");

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
    createAsUser?: string;
    displayIconUrl?: string;
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
  return client.updateIssue(issueId, input);
}

export async function getIssueByIdentifier(
  client: LinearClient,
  identifier: string,
) {
  const results = await client.searchIssues(identifier, { first: 5 });
  return results.nodes.find((i) => i.identifier === identifier) ?? null;
}

export async function searchIssues(
  client: LinearClient,
  query: string,
  first = 10,
) {
  return client.searchIssues(query, { first });
}

export async function createComment(
  client: LinearClient,
  input: {
    issueId: string;
    body: string;
    createAsUser?: string;
    displayIconUrl?: string;
  },
) {
  const result = await client.createComment(input);
  const comment = await result.comment;
  if (!comment) throw new Error("评论创建失败");
  log.info({ id: comment.id, issueId: input.issueId }, "评论已创建");
  return comment;
}

export async function linkUrlAttachment(
  client: LinearClient,
  issueId: string,
  url: string,
  title?: string,
) {
  return client.attachmentLinkURL(issueId, url, {
    title: title ?? "飞书消息",
  });
}

export async function getTeams(client: LinearClient) {
  const teams = await client.teams();
  return teams.nodes;
}

export async function getProjects(client: LinearClient, first = 50) {
  const projects = await client.projects({ first });
  return projects.nodes;
}

export async function getProject(client: LinearClient, projectId: string) {
  return client.project(projectId);
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

export async function findUserByEmail(client: LinearClient, email: string) {
  const users = await getUsers(client);
  return users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

export async function subscribeIssue(client: LinearClient, issueId: string) {
  return client.issueSubscribe(issueId);
}

export async function unsubscribeIssue(client: LinearClient, issueId: string) {
  return client.issueUnsubscribe(issueId);
}

export async function getOrganizationId(client: LinearClient) {
  const org = await client.organization;
  return org.id;
}
