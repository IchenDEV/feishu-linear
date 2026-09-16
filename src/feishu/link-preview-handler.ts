import type { Context } from "koa";
import "../types.js";
import type { LinearClient } from "@linear/sdk";
import type { Env } from "../config.js";
import { parseLinearUrl } from "../utils/text.js";
import * as linearOps from "../linear/client.js";
import {
  buildIssueLinkPreview,
  buildProjectLinkPreview,
} from "../cards/link-preview.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("link-preview");

export function createLinkPreviewHandler(config: Env, linear: LinearClient) {
  return async (ctx: Context) => {
    const body = ctx.request.body as Record<string, unknown>;

    // URL 验证
    if (body.type === "url_verification") {
      ctx.body = { challenge: body.challenge };
      return;
    }

    const event = body.event as Record<string, unknown> | undefined;
    if (!event) {
      ctx.body = {};
      return;
    }

    const context = event.context as Record<string, unknown> | undefined;
    const url = context?.url as string;

    if (!url) {
      ctx.body = {};
      return;
    }

    log.info({ url }, "链接预览请求");

    const parsed = parseLinearUrl(url);
    if (!parsed) {
      ctx.body = {};
      return;
    }

    try {
      switch (parsed.type) {
        case "issue": {
          if (!parsed.identifier) break;
          const results = await linearOps.searchIssues(linear, parsed.identifier, {
            first: 1,
          });
          const issue = results.nodes[0];
          if (!issue) break;

          const state = await issue.state;
          const assignee = await issue.assignee;

          ctx.body = buildIssueLinkPreview({
            identifier: issue.identifier,
            title: issue.title,
            description: issue.description ?? undefined,
            status: state?.name ?? "Unknown",
            assignee: assignee?.name,
            createdAt: issue.createdAt.toISOString().split("T")[0],
            url: issue.url,
          });
          return;
        }

        case "project": {
          if (!parsed.id) break;
          const project = await linearOps.getProject(linear, parsed.id);
          if (!project) break;

          ctx.body = buildProjectLinkPreview({
            name: project.name,
            description: project.description ?? undefined,
            status: project.state,
            targetDate: project.targetDate ?? undefined,
            url: project.url,
          });
          return;
        }

        default:
          break;
      }
    } catch (err) {
      log.error({ err, url }, "链接预览处理失败");
    }

    ctx.body = {
      inline: {
        i18n_title: {
          zh_cn: `Linear: ${url}`,
          en_us: `Linear: ${url}`,
        },
      },
    };
  };
}
