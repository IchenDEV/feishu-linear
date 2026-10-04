import { eq } from "drizzle-orm";
import type { AppContext } from "../../app/context.js";
import { schema } from "../../db/index.js";
import * as feishu from "../../adapters/feishu/client.js";
import { buildIssueNotifyCard } from "../../cards/issue.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("view-poll");

const QUERY = `
query ViewIssues($id: String!, $first: Int!) {
  customView(id: $id) {
    issues(first: $first) {
      nodes {
        id identifier title url
        state { name type }
        assignee { name }
      }
    }
  }
}`;

interface ViewIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  state?: { name: string; type: string };
  assignee?: { name: string };
}

const isDone = (i: ViewIssue) => i.state?.type === "completed" || i.state?.type === "canceled";

export interface ViewDiff {
  added: ViewIssue[];
  completed: ViewIssue[];
  snapshot: Record<string, boolean>;
}

/** 对比上次快照：新进入视图的 Issue、以及视图内由未完成变为完成的 Issue。`prev` 为 null 表示首次（只建基线） */
export function diffView(prev: Record<string, boolean> | null, current: ViewIssue[]): ViewDiff {
  const snapshot: Record<string, boolean> = {};
  const added: ViewIssue[] = [];
  const completed: ViewIssue[] = [];
  for (const i of current) {
    snapshot[i.id] = isDone(i);
    if (!prev) continue;
    if (!(i.id in prev)) added.push(i);
    else if (!prev[i.id] && isDone(i)) completed.push(i);
  }
  return { added, completed, snapshot };
}

const MAX_PER_RUN = 10;

/** 轮询所有视图订阅（Linear 没有视图级 webhook，所以用 cron 定时拉取对比） */
export async function pollViewSubscriptions(ctx: AppContext) {
  const subs = await ctx.db.select().from(schema.viewSubscriptions);
  if (!subs.length) return { checked: 0 };
  const linear = await ctx.getLinear();

  for (const sub of subs) {
    try {
      const res = await linear.client.rawRequest<
        { customView: { issues: { nodes: ViewIssue[] } } | null },
        { id: string; first: number }
      >(QUERY, { id: sub.linearViewId, first: 200 });
      const nodes = res.data?.customView?.issues?.nodes;
      if (!nodes) continue;

      const diff = diffView(sub.snapshot ?? null, nodes);
      const wantAdded = sub.trigger === "added" || sub.trigger === "both";
      const wantDone = sub.trigger === "completed" || sub.trigger === "both";

      const send = async (issues: ViewIssue[], action: string) => {
        for (const i of issues.slice(0, MAX_PER_RUN)) {
          await feishu.sendCard(
            ctx.lark,
            sub.feishuChatId,
            buildIssueNotifyCard({
              identifier: i.identifier,
              title: i.title,
              status: i.state?.name,
              statusType: i.state?.type,
              url: i.url,
              action,
              actor: `视图「${sub.linearViewName ?? "View"}」`,
              assignee: i.assignee?.name,
            }),
          );
        }
        if (issues.length > MAX_PER_RUN) {
          await feishu.sendText(
            ctx.lark,
            sub.feishuChatId,
            `视图「${sub.linearViewName}」另有 ${issues.length - MAX_PER_RUN} 个 Issue ${action}，请在 Linear 中查看。`,
          );
        }
      };

      if (wantAdded) await send(diff.added, "新进入视图");
      if (wantDone) await send(diff.completed, "视图内已完成");

      await ctx.db
        .update(schema.viewSubscriptions)
        .set({ snapshot: diff.snapshot, snapshotAt: new Date() })
        .where(eq(schema.viewSubscriptions.id, sub.id));
    } catch (err) {
      log.error({ err, view: sub.linearViewId }, "视图订阅轮询失败");
    }
  }
  return { checked: subs.length };
}
