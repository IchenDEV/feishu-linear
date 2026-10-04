import type { AppContext } from "../../app/context.js";
import * as linearApi from "../../adapters/linear/api.js";
import {
  isFromFeishu,
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
import { getPriorityLabel } from "../../cards/issue.js";
import { listMappings } from "../users/mapping.js";
import { t } from "../../i18n/index.js";
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
      log.debug({ type: ev.type, action: ev.action }, "Unhandled Linear event");
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
    await notifyIssueToChats(ctx, { ...base, trigger: "created", action: () => t("notify.newIssue") });
    if (d.assigneeId && d.assigneeId !== ev.actor?.id) {
      await notifyPersonal(ctx, {
        linearUserIds: [d.assigneeId],
        kind: "assigned",
        event: { ...base, action: () => t("notify.assignedNew") },
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
      action: () =>
        done
          ? base.statusType === "completed"
            ? t("notify.completed")
            : t("notify.canceled")
          : t("notify.statusChange"),
      detail: () => t("notify.statusChangedTo", { status: base.status }),
    });
    const people = await issueStakeholders(ctx, d.id);
    await notifyPersonal(ctx, {
      linearUserIds: people,
      kind: "status",
      excludeLinearUserId: ev.actor?.id,
      event: {
        ...base,
        action: () => t("notify.issueStatusChange"),
        detail: () => t("notify.statusChangedTo", { status: base.status }),
      },
    });
  }

  if ("assigneeId" in changed) {
    await notifyIssueToChats(ctx, {
      ...base,
      trigger: "updated",
      action: () => t("notify.assigneeChange"),
      detail: () => t("notify.assigneeChangedTo", { name: base.assignee ?? t("field.unassigned") }),
    });
    if (d.assigneeId && d.assigneeId !== ev.actor?.id) {
      await notifyPersonal(ctx, {
        linearUserIds: [d.assigneeId],
        kind: "assigned",
        event: { ...base, action: () => t("notify.assignedToYou") },
      });
    }
  }

  if ("priority" in changed) {
    await notifyIssueToChats(ctx, {
      ...base,
      trigger: "updated",
      action: () => t("notify.priorityChange"),
      detail: () => t("notify.priorityChangedTo", { name: getPriorityLabel(d.priority) }),
    });
  }
}

// ───────────────────────── Comment ─────────────────────────

async function onComment(ctx: AppContext, ev: LinearEvent, actor: string) {
  if (ev.action !== "create") return;
  const d = ev.data;
  const body = (d.body as string) ?? "";
  if (isFromFeishu(body)) return; // 我们自己同步过去的

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
    action: () => t("notify.newComment"),
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
      event: { ...base, action: () => t("notify.mentioned"), detail: excerpt },
    });
  }
  const people = (await issueStakeholders(ctx, issue.id)).filter(
    (id) => !mentioned.includes(id),
  );
  await notifyPersonal(ctx, {
    linearUserIds: people,
    kind: "comment",
    excludeLinearUserId: ev.actor?.id,
    event: { ...base, action: () => t("notify.followedComment"), detail: excerpt },
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
        log.error({ err, id }, "Failed to auto-create the project channel");
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
      action: () => t("notify.projectStatusChange"),
      name,
      status,
      url,
      actor,
      detail: () => t("notify.projectStatusChangedTo", { status }),
    });
  }
}

async function onProjectUpdate(ctx: AppContext, ev: LinearEvent, actor: string) {
  if (ev.action !== "create") return;
  const d = ev.data;
  const projectId = (d.projectId ?? d.project?.id) as string;
  const healthOf = () => (d.health ? t("notify.health", { health: d.health }) : "");
  await notifyProjectEvent(ctx, {
    trigger: "updated",
    projectId,
    initiativeIds: await projectInitiativeIds(ctx, projectId),
    action: () => t("notify.projectUpdate", { health: healthOf() }),
    name: (d.project?.name as string) ?? t("notify.projectFallback"),
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
    action: () => t("notify.initiativeStatusChange"),
    name: d.name,
    status,
    url: ev.url ?? "",
    actor,
    detail: () => t("notify.statusChangedTo", { status }),
  });
}

async function onInitiativeUpdate(ctx: AppContext, ev: LinearEvent, actor: string) {
  if (ev.action !== "create") return;
  const d = ev.data;
  await notifyInitiativeEvent(ctx, {
    trigger: "updated",
    initiativeId: (d.initiativeId ?? d.initiative?.id) as string,
    action: () => t("notify.initiativeUpdate", { health: d.health ? t("notify.health", { health: d.health }) : "" }),
    name: (d.initiative?.name as string) ?? "Initiative",
    url: ev.url ?? "",
    actor,
    detail: (d.body as string) ?? "",
  });
}
