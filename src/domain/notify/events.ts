import type { AppContext } from "../../app/context.js";
import * as linearApi from "../../adapters/linear/api.js";
import {
  FROM_FEISHU_MARK,
  handleDuplicate,
  notifyStatusChange,
  syncLinearCommentToFeishu,
} from "../sync/threads.js";
import {
  createProjectChannel,
  isAutoProjectChannelEnabled,
  issueStakeholders,
  notifyInitiativeEvent,
  notifyIssueToChats,
  notifyPersonal,
  notifyProjectEvent,
  syncProjectChannelMembers,
  syncProjectChannelName,
  getProjectChannel,
} from "./engine.js";
import { listMappings } from "../users/mapping.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("linear-events");

type Obj = Record<string, any>;

export interface LinearEvent {
  type?: string;
  action?: string;
  data: Obj;
  actor?: { id?: string; name?: string };
  url?: string;
  updatedFrom: Obj;
}

/** Linear Webhook 事件分发：线程同步、状态提示、五层通知、项目频道 */
export async function handleLinearEvent(ctx: AppContext, ev: LinearEvent) {
  const actor = ev.actor?.name ?? "Unknown";
  switch (ev.type) {
    case "Issue":
      return onIssue(ctx, ev, actor);
    case "Comment":
      return onComment(ctx, ev, actor);
    case "IssueRelation":
      return onRelation(ctx, ev, actor);
    case "Project":
      return onProject(ctx, ev, actor);
    case "ProjectUpdate":
      return onProjectUpdate(ctx, ev, actor);
    case "Initiative":
      return onInitiative(ctx, ev, actor);
    case "InitiativeUpdate":
      return onInitiativeUpdate(ctx, ev, actor);
    default:
      log.debug({ type: ev.type, action: ev.action }, "未处理的 Linear 事件");
  }
}

// ───────────────────────── Issue ─────────────────────────

async function onIssue(ctx: AppContext, ev: LinearEvent, actor: string) {
  const d = ev.data;
  const base = {
    issueId: d.id as string,
    identifier: d.identifier as string,
    title: d.title as string,
    status: d.state?.name as string | undefined,
    statusType: d.state?.type as string | undefined,
    assignee: d.assignee?.name as string | undefined,
    url: ev.url ?? "",
    actor,
    actorId: ev.actor?.id,
    teamId: d.teamId as string | undefined,
    projectId: d.projectId as string | undefined,
  };

  if (ev.action === "create") {
    await notifyIssueToChats(ctx, { ...base, trigger: "created", action: "新 Issue" });
    if (d.assigneeId && d.assigneeId !== ev.actor?.id) {
      await notifyPersonal(ctx, {
        linearUserIds: [d.assigneeId],
        kind: "assigned",
        event: { ...base, action: "你被分配了新 Issue" },
      });
    }
    return;
  }

  if (ev.action !== "update") return;
  const changed = ev.updatedFrom;

  if ("stateId" in changed) {
    await notifyStatusChange(ctx, {
      linearIssueId: d.id,
      status: base.status ?? "Unknown",
      statusType: base.statusType,
      actor,
    });
    const done = base.statusType === "completed" || base.statusType === "canceled";
    await notifyIssueToChats(ctx, {
      ...base,
      trigger: done ? "completed" : "updated",
      action: done ? (base.statusType === "completed" ? "✅ 已完成" : "❌ 已取消") : "状态变更",
      detail: `状态变更为 **${base.status}**`,
    });
    const people = await issueStakeholders(ctx, d.id);
    await notifyPersonal(ctx, {
      linearUserIds: people,
      kind: "status",
      excludeLinearUserId: ev.actor?.id,
      event: { ...base, action: "Issue 状态变更", detail: `状态变更为 **${base.status}**` },
    });
  }

  if ("assigneeId" in changed) {
    await notifyIssueToChats(ctx, {
      ...base,
      trigger: "updated",
      action: "负责人变更",
      detail: `负责人变更为 **${base.assignee ?? "未分配"}**`,
    });
    if (d.assigneeId && d.assigneeId !== ev.actor?.id) {
      await notifyPersonal(ctx, {
        linearUserIds: [d.assigneeId],
        kind: "assigned",
        event: { ...base, action: "Issue 被分配给你" },
      });
    }
  }

  if ("priority" in changed) {
    const labels = ["无优先级", "Urgent", "High", "Medium", "Low"];
    await notifyIssueToChats(ctx, {
      ...base,
      trigger: "updated",
      action: "优先级变更",
      detail: `优先级变更为 **${labels[d.priority] ?? d.priority}**`,
    });
  }
}

// ───────────────────────── Comment ─────────────────────────

async function onComment(ctx: AppContext, ev: LinearEvent, actor: string) {
  if (ev.action !== "create") return;
  const d = ev.data;
  const body = (d.body as string) ?? "";
  if (body.slice(0, 200).includes(FROM_FEISHU_MARK)) return; // 我们自己同步过去的

  await syncLinearCommentToFeishu(ctx, {
    linearIssueId: d.issueId,
    linearCommentId: d.id,
    actorName: actor,
    body,
  });

  // 取 Issue 详情用于通知（Comment payload 里只有简要信息）
  const linear = await ctx.getLinear();
  const issue = await linearApi.getIssue(linear, d.issueId);
  if (!issue) return;
  const [state, assignee, team, project] = await Promise.all([
    issue.state,
    issue.assignee,
    issue.team,
    issue.project,
  ]);
  const base = {
    identifier: issue.identifier,
    title: issue.title,
    status: state?.name,
    statusType: state?.type,
    assignee: assignee?.name,
    url: (d.url as string) || issue.url,
    actor,
    actorId: ev.actor?.id,
  };
  const excerpt = body.length > 300 ? `${body.slice(0, 300)}…` : body;

  await notifyIssueToChats(ctx, {
    ...base,
    issueId: issue.id,
    teamId: team?.id,
    projectId: project?.id,
    trigger: "comment",
    action: "💬 新评论",
    detail: excerpt,
  });

  // 个人：被 @ 的人优先，其次是相关人（负责人 / 创建者 / 订阅者）
  const mentioned = (await listMappings(ctx))
    .filter((m) => m.linearName && body.includes(`@${m.linearName}`))
    .map((m) => m.linearUserId);
  if (mentioned.length) {
    await notifyPersonal(ctx, {
      linearUserIds: mentioned,
      kind: "mentioned",
      excludeLinearUserId: ev.actor?.id,
      event: { ...base, action: "💬 你被 @ 提及", detail: excerpt },
    });
  }
  const people = (await issueStakeholders(ctx, issue.id)).filter(
    (id) => !mentioned.includes(id),
  );
  await notifyPersonal(ctx, {
    linearUserIds: people,
    kind: "comment",
    excludeLinearUserId: ev.actor?.id,
    event: { ...base, action: "💬 你关注的 Issue 有新评论", detail: excerpt },
  });
}

// ───────────────────────── IssueRelation ─────────────────────────

async function onRelation(ctx: AppContext, ev: LinearEvent, actor: string) {
  if (ev.action !== "create" || ev.data.type !== "duplicate") return;
  await handleDuplicate(ctx, {
    duplicateIssueId: ev.data.issueId,
    originalIssueId: ev.data.relatedIssueId,
    actor,
  });
}

// ───────────────────────── Project ─────────────────────────

async function projectInitiativeIds(ctx: AppContext, projectId: string): Promise<string[]> {
  try {
    const linear = await ctx.getLinear();
    const project = await linear.project(projectId);
    return (await project.initiatives()).nodes.map((i) => i.id);
  } catch {
    return [];
  }
}

function projectStatus(d: Obj): string {
  return String(d.status?.name ?? d.state ?? "");
}

async function onProject(ctx: AppContext, ev: LinearEvent, actor: string) {
  const d = ev.data;
  const id = d.id as string;
  const name = d.name as string;
  const url = ev.url ?? "";

  if (ev.action === "create") {
    if (await isAutoProjectChannelEnabled(ctx)) {
      try {
        await createProjectChannel(ctx, { projectId: id, autoCreated: true });
      } catch (err) {
        log.error({ err, id }, "自动创建项目频道失败");
      }
    }
    return;
  }

  if (ev.action !== "update") return;
  const changed = ev.updatedFrom;
  if ("name" in changed && (await getProjectChannel(ctx, id))) {
    await syncProjectChannelName(ctx, id, name);
  }
  if ("memberIds" in changed || "leadId" in changed) {
    await syncProjectChannelMembers(ctx, id);
  }
  if ("statusId" in changed || "state" in changed) {
    const status = projectStatus(d);
    const done = /complete|cancel/i.test(status);
    await notifyProjectEvent(ctx, {
      trigger: done ? "completed" : "updated",
      projectId: id,
      initiativeIds: await projectInitiativeIds(ctx, id),
      action: "项目状态变更",
      name,
      status,
      url,
      actor,
      detail: `项目状态变更为 **${status}**`,
    });
  }
}

async function onProjectUpdate(ctx: AppContext, ev: LinearEvent, actor: string) {
  if (ev.action !== "create") return;
  const d = ev.data;
  const projectId = (d.projectId ?? d.project?.id) as string;
  const health = d.health ? `（${d.health}）` : "";
  await notifyProjectEvent(ctx, {
    trigger: "updated",
    projectId,
    initiativeIds: await projectInitiativeIds(ctx, projectId),
    action: `项目更新${health}`,
    name: (d.project?.name as string) ?? "项目",
    url: ev.url ?? "",
    actor,
    detail: (d.body as string) ?? "",
  });
}

// ───────────────────────── Initiative ─────────────────────────

async function onInitiative(ctx: AppContext, ev: LinearEvent, actor: string) {
  if (ev.action !== "update" || !("status" in ev.updatedFrom)) return;
  const d = ev.data;
  const status = String(d.status?.name ?? d.status ?? "");
  await notifyInitiativeEvent(ctx, {
    trigger: /complete/i.test(status) ? "completed" : "updated",
    initiativeId: d.id,
    action: "Initiative 状态变更",
    name: d.name,
    status,
    url: ev.url ?? "",
    actor,
    detail: `状态变更为 **${status}**`,
  });
}

async function onInitiativeUpdate(ctx: AppContext, ev: LinearEvent, actor: string) {
  if (ev.action !== "create") return;
  const d = ev.data;
  await notifyInitiativeEvent(ctx, {
    trigger: "updated",
    initiativeId: (d.initiativeId ?? d.initiative?.id) as string,
    action: `Initiative 更新${d.health ? `（${d.health}）` : ""}`,
    name: (d.initiative?.name as string) ?? "Initiative",
    url: ev.url ?? "",
    actor,
    detail: (d.body as string) ?? "",
  });
}
