import type { AppContext } from "../app/context.js";
import * as linearApi from "../adapters/linear/api.js";
import {
  buildDocumentCard,
  buildInitiativeCard,
  buildIssueCard,
  buildIssueCompactCard,
  buildProjectCard,
  type IssueCardContext,
} from "../cards/issue.js";
import { parseLinearUrl, slugTail } from "../utils/text.js";
import { toIssueCardData } from "./issues/service.js";
import { findByLinearIssue } from "./sync/threads.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("unfurl");

export interface Unfurl {
  title: string;
  card: Record<string, unknown>;
}

/** 依次尝试 slug 与其 slugId，取第一个成功的结果 */
async function tryIds<T>(slug: string, fn: (id: string) => Promise<T>): Promise<T | null> {
  for (const id of [...new Set([slug, slugTail(slug)])]) {
    try {
      const r = await fn(id);
      if (r) return r;
    } catch {
      /* 换下一种 id 形式 */
    }
  }
  return null;
}

/**
 * Linear 链接 → 卡片。
 * - 私有团队（private team）里的 Issue / 项目一律不展开，避免把受限内容暴露给群里没有权限的人
 * - `compact` 用于飞书原生链接预览（3 秒时限、没有会话上下文）；否则返回带评论 / 同步按钮的完整卡片
 */
export async function unfurlLinearUrl(
  ctx: AppContext,
  url: string,
  opts: { compact?: boolean; card?: IssueCardContext } = {},
): Promise<Unfurl | null> {
  const parsed = parseLinearUrl(url);
  if (!parsed || parsed.type === "unknown") return null;
  const linear = await ctx.getLinear();

  try {
    switch (parsed.type) {
      case "issue": {
        const issue = await linearApi.getIssue(linear, parsed.identifier!);
        if (!issue) return null;
        const team = await issue.team;
        if (team?.private) {
          log.debug({ issue: issue.identifier }, "私有团队，不展开");
          return null;
        }
        const synced = Boolean(await findByLinearIssue(ctx, issue.id));
        const data = await toIssueCardData(issue, { synced });
        return {
          title: `${data.identifier} ${data.title}`,
          card: opts.compact ? buildIssueCompactCard(data) : buildIssueCard(data, opts.card),
        };
      }

      case "project": {
        const p = await tryIds(parsed.id!, (id) => linearApi.getProject(linear, id));
        if (!p) return null;
        const teams = (await p.teams()).nodes;
        if (teams.length && teams.every((t) => t.private)) return null;
        return {
          title: `📁 ${p.name}`,
          card: buildProjectCard({
            name: p.name,
            description: p.description ?? undefined,
            status: String(p.state ?? ""),
            lead: (await p.lead)?.name,
            targetDate: p.targetDate ?? undefined,
            progress: p.progress,
            url: p.url,
          }),
        };
      }

      case "document": {
        const d = await tryIds(parsed.id!, (id) => linearApi.getDocument(linear, id));
        if (!d) return null;
        const project = await d.project;
        if (project) {
          const teams = (await project.teams()).nodes;
          if (teams.length && teams.every((t) => t.private)) return null;
        }
        return {
          title: `📄 ${d.title}`,
          card: buildDocumentCard({
            title: d.title,
            snippet: d.content?.slice(0, 300),
            creator: (await d.creator)?.name,
            updatedAt: d.updatedAt.toISOString().split("T")[0],
            url: d.url,
          }),
        };
      }

      case "initiative": {
        const i = await tryIds(parsed.id!, (id) => linearApi.getInitiative(linear, id));
        if (!i) return null;
        return {
          title: `🎯 ${i.name}`,
          card: buildInitiativeCard({
            name: i.name,
            description: i.description ?? undefined,
            status: String(i.status ?? ""),
            owner: (await i.owner)?.name,
            targetDate: i.targetDate ?? undefined,
            url: i.url,
          }),
        };
      }
    }
  } catch (err) {
    log.warn({ err, url }, "链接展开失败");
  }
  return null;
}
