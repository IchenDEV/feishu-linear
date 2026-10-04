import { createHash, randomBytes } from "node:crypto";
import Router from "@koa/router";
import type { Context, Next } from "koa";
import type { AppContext } from "../../app/context.js";
import * as linearApi from "../../adapters/linear/api.js";
import { renderMessageActionPage } from "./page.js";
import { signSession, verifySession } from "./session.js";
import { createIssueFromFeishu } from "../../domain/issues/service.js";
import { fetchSourceMessage, deriveTitle } from "../../domain/messages/source.js";
import { resolveChatDefaults } from "../../domain/settings/store.js";
import {
  NotBoundError,
  resolveLinearIdentity,
} from "../../domain/users/mapping.js";
import type { Attachment } from "../../domain/messages/content.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("h5");

const OPEN = "https://open.feishu.cn";

/** jsapi_ticket 缓存（有效期 2 小时，提前 5 分钟刷新） */
let ticketCache: { ticket: string; exp: number } | null = null;

async function getJsapiTicket(ctx: AppContext): Promise<string> {
  if (ticketCache && ticketCache.exp > Date.now()) return ticketCache.ticket;
  const res = (await ctx.lark.request({
    method: "POST",
    url: "/open-apis/jssdk/ticket/get",
    data: {},
  })) as { code?: number; data?: { ticket?: string; expire_in?: number } };
  const ticket = res?.data?.ticket;
  if (!ticket) throw new Error(`获取 jsapi_ticket 失败 code=${res?.code}`);
  ticketCache = { ticket, exp: Date.now() + ((res.data?.expire_in ?? 7200) - 300) * 1000 };
  return ticket;
}

/** 授权码 → open_id（requestAccess 返回的 code，走 authen v2） */
async function openIdFromCode(ctx: AppContext, code: string) {
  const tokenRes = await fetch(`${OPEN}/open-apis/authen/v2/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: ctx.config.FEISHU_APP_ID,
      client_secret: ctx.config.FEISHU_APP_SECRET,
      code,
    }),
  });
  const t = (await tokenRes.json()) as { access_token?: string; code?: number; error_description?: string };
  if (!t.access_token) throw new Error(`换取用户身份失败：${t.error_description ?? t.code}`);
  const infoRes = await fetch(`${OPEN}/open-apis/authen/v1/user_info`, {
    headers: { authorization: `Bearer ${t.access_token}` },
  });
  const info = (await infoRes.json()) as { data?: { open_id?: string; name?: string } };
  if (!info.data?.open_id) throw new Error("读取用户信息失败");
  return { openId: info.data.open_id, name: info.data.name };
}

interface H5State {
  openId: string;
}

export function createH5Router(ctx: AppContext) {
  const router = new Router({ prefix: "/h5" });
  const secret = ctx.config.FEISHU_APP_SECRET;

  const auth = async (c: Context, next: Next) => {
    const token = (c.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const openId = token ? verifySession(secret, token) : null;
    if (!openId) {
      c.status = 401;
      c.body = { error: "登录已过期，请重新打开" };
      return;
    }
    (c.state as H5State).openId = openId;
    await next();
  };

  router.get("/message-action", (c) => {
    c.type = "html";
    c.set("cache-control", "no-store");
    c.body = renderMessageActionPage(ctx.config.FEISHU_APP_ID);
  });

  router.get("/jssdk-sign", async (c) => {
    const url = String(c.query.url ?? "");
    // 只给本站页面签名
    if (!url.startsWith(ctx.config.PUBLIC_URL)) {
      c.status = 400;
      c.body = { error: "url 不合法" };
      return;
    }
    const ticket = await getJsapiTicket(ctx);
    const noncestr = randomBytes(8).toString("hex");
    const timestamp = String(Date.now());
    const signature = createHash("sha1")
      .update(`jsapi_ticket=${ticket}&noncestr=${noncestr}&timestamp=${timestamp}&url=${url}`)
      .digest("hex");
    c.body = { appid: ctx.config.FEISHU_APP_ID, timestamp, noncestr, signature };
  });

  router.post("/api/session", async (c) => {
    const { code } = (c.request.body ?? {}) as { code?: string };
    if (!code) {
      c.status = 400;
      c.body = { error: "缺少 code" };
      return;
    }
    try {
      const { openId, name } = await openIdFromCode(ctx, code);
      c.body = { token: signSession(secret, openId), name };
    } catch (err) {
      log.warn({ err }, "H5 登录失败");
      c.status = 401;
      c.body = { error: err instanceof Error ? err.message : String(err) };
    }
  });

  /** 解析被选中的消息 → 预填标题 / 描述 / 附件数，并返回表单选项 */
  router.post("/api/prepare", auth, async (c) => {
    const { openId } = c.state as H5State;
    const picked = ((c.request.body as { messages?: Array<Record<string, any>> })?.messages ?? [])
      .filter((m) => m.openMessageId)
      .slice(0, 20);
    if (!picked.length) {
      c.status = 400;
      c.body = { error: "没有读取到消息" };
      return;
    }
    if (!(await resolveLinearIdentity(ctx, openId))) {
      c.status = 403;
      c.body = { error: new NotBoundError().message };
      return;
    }

    const chatId = String(picked[0].openChatId ?? "");
    const parsed = await Promise.all(picked.map((m) => fetchSourceMessage(ctx, m.openMessageId)));
    const lines: string[] = [];
    let attachments = 0;
    parsed.forEach((p, i) => {
      const who = p?.senderName ?? picked[i].sender?.name ?? "";
      const text = p?.text ?? "";
      attachments += p?.attachments.length ?? 0;
      lines.push(picked.length > 1 && who ? `**${who}**：${text}` : text);
    });
    const description = lines.filter(Boolean).join("\n\n");

    const linear = await ctx.getLinear();
    const [teams, defaults] = await Promise.all([
      linearApi.getTeams(linear),
      resolveChatDefaults(ctx, chatId),
    ]);
    const team = teams.find((t) => t.id === defaults.teamId) ?? teams[0];
    const options = await linearApi.getTeamFormOptions(linear, team.id);
    c.body = {
      chatId,
      messageIds: picked.map((m) => m.openMessageId),
      title: deriveTitle(parsed[0]?.text ?? "", "来自飞书的消息"),
      description,
      preview: description.slice(0, 600),
      attachmentCount: attachments,
      teams: teams.map((t) => ({ id: t.id, name: t.name })),
      defaults,
      options: { ...options, teamId: team.id },
    };
  });

  router.get("/api/options", auth, async (c) => {
    const linear = await ctx.getLinear();
    const teamId = String(c.query.teamId ?? "");
    c.body = { ...(await linearApi.getTeamFormOptions(linear, teamId)), teamId };
  });

  router.post("/api/create", auth, async (c) => {
    const { openId } = c.state as H5State;
    const b = (c.request.body ?? {}) as Record<string, any>;
    const ids: string[] = Array.isArray(b.messageIds) ? b.messageIds.slice(0, 20) : [];
    if (!b.title || !ids.length || !b.chatId) {
      c.status = 400;
      c.body = { error: "缺少标题或消息" };
      return;
    }
    try {
      const parsed = (await Promise.all(ids.map((id) => fetchSourceMessage(ctx, id)))).filter(
        (p): p is NonNullable<typeof p> => Boolean(p),
      );
      const attachments: Attachment[] = parsed.flatMap((p) => p.attachments);
      // 同步/回链以最后一条被选中的消息为锚点
      const anchor = parsed[parsed.length - 1];
      const { issue, synced } = await createIssueFromFeishu(ctx, {
        chatId: String(b.chatId),
        operatorOpenId: openId,
        title: String(b.title),
        description: b.description ? String(b.description) : undefined,
        teamId: b.teamId,
        projectId: b.projectId,
        stateId: b.stateId,
        templateId: b.templateId,
        labelIds: b.labelIds,
        priority: b.priority,
        source: anchor
          ? {
              messageId: anchor.messageId,
              threadId: anchor.threadId,
              attachments,
              excerpt: parsed[0]?.text,
            }
          : undefined,
        sync: Boolean(b.sync),
        replyInThread: Boolean(b.sync),
      });
      c.body = { identifier: issue.identifier, title: issue.title, url: issue.url, synced };
    } catch (err) {
      c.status = err instanceof NotBoundError ? 403 : 500;
      c.body = { error: err instanceof Error ? err.message : String(err) };
      if (!(err instanceof NotBoundError)) log.error({ err }, "H5 创建 Issue 失败");
    }
  });

  return router;
}
