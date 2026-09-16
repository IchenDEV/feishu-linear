import type { Request, Response } from "express";
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
  return async (req: Request, res: Response) => {
    const body = req.body;

    // URL 验证
    if (body.type === "url_verification") {
      res.json({ challenge: body.challenge });
      return;
    }

    const event = body.event;
    if (!event) {
      res.json({});
      return;
    }

    const url = event.context?.url as string;
    const previewToken = event.context?.preview_token as string;

    if (!url) {
      res.json({});
      return;
    }

    log.info({ url }, "链接预览请求");

    const parsed = parseLinearUrl(url);
    if (!parsed) {
      res.json({});
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

          const preview = buildIssueLinkPreview({
            identifier: issue.identifier,
            title: issue.title,
            description: issue.description ?? undefined,
            status: state?.name ?? "Unknown",
            assignee: assignee?.name,
            createdAt: issue.createdAt.toISOString().split("T")[0],
            url: issue.url,
          });

          res.json(preview);
          return;
        }

        case "project": {
          if (!parsed.id) break;
          const project = await linearOps.getProject(linear, parsed.id);
          if (!project) break;

          const preview = buildProjectLinkPreview({
            name: project.name,
            description: project.description ?? undefined,
            status: project.state,
            targetDate: project.targetDate ?? undefined,
            url: project.url,
          });

          res.json(preview);
          return;
        }

        default:
          break;
      }
    } catch (err) {
      log.error({ err, url }, "链接预览处理失败");
    }

    // 回退：至少返回 inline
    res.json({
      inline: {
        i18n_title: {
          zh_cn: `Linear: ${url}`,
          en_us: `Linear: ${url}`,
        },
      },
    });
  };
}
