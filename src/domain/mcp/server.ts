import type { AppContext } from "../../app/context.js";
import * as feishu from "../../adapters/feishu/client.js";
import { parseMessage } from "../messages/content.js";
import { linearTools, type ToolDef } from "../agent/tools.js";
import { createSyncThreadForIssue, findByLinearIssue } from "../sync/threads.js";
import { getFeishuUserName } from "../users/mapping.js";

/**
 * 最小 MCP 服务端（Streamable HTTP，无状态，JSON 响应）。
 * 让外部 AI 客户端（Cursor / Claude / 自建 Agent）同时拥有 Linear 工具与飞书上下文工具，
 * 对标 Linear 在 Slack 里「AI 工具可读取 Slack 上下文」的体验。
 */

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
});

const feishuTools: ToolDef[] = [
  {
    name: "feishu_read_messages",
    description: "Read message history from a Feishu chat or thread (plain text, including attachment names)",
    parameters: obj(
      {
        chatId: { type: "string", description: "Chat ID (starts with oc_)" },
        threadId: { type: "string", description: "Thread ID (starts with omt_). When set, the thread is read instead" },
        limit: { type: "number", description: "Maximum 50" },
      },
      ["chatId"],
    ),
    run: async ({ ctx }, a) => {
      const msgs = await feishu.listMessages(ctx.lark, {
        containerType: a.threadId ? "thread" : "chat",
        containerId: a.threadId ?? a.chatId,
        max: Math.min(a.limit ?? 30, 50),
      });
      const names = new Map<string, string>();
      return Promise.all(
        msgs
          .filter((m) => !m.deleted)
          .map(async (m) => {
            const p = parseMessage(m.messageId, m.msgType, m.content);
            let who = "Assistant";
            if (m.senderType === "user" && m.senderId) {
              if (!names.has(m.senderId)) names.set(m.senderId, await getFeishuUserName(ctx, m.senderId));
              who = names.get(m.senderId)!;
            }
            return {
              messageId: m.messageId,
              time: m.createTime ? new Date(m.createTime).toISOString() : undefined,
              from: who,
              text: p.text,
              attachments: p.attachments.map((x) => x.name),
            };
          }),
      );
    },
  },
  {
    name: "feishu_send_message",
    description: "Send a text message to a Feishu chat as the bot",
    write: true,
    parameters: obj({ chatId: { type: "string" }, text: { type: "string" } }, ["chatId", "text"]),
    run: async ({ ctx }, a) => {
      const res = await feishu.sendText(ctx.lark, a.chatId, a.text);
      return { messageId: (res.data as Record<string, unknown>)?.message_id };
    },
  },
  {
    name: "feishu_reply_message",
    description: "Reply to a Feishu message (optionally inside a thread)",
    write: true,
    parameters: obj(
      { messageId: { type: "string" }, text: { type: "string" }, inThread: { type: "boolean" } },
      ["messageId", "text"],
    ),
    run: async ({ ctx }, a) => {
      const res = await feishu.replyMarkdown(ctx.lark, a.messageId, a.text, Boolean(a.inThread));
      return { messageId: (res.data as Record<string, unknown>)?.message_id };
    },
  },
  {
    name: "linear_sync_feishu_thread",
    description: "Two-way sync a Feishu thread with a Linear issue (rootMessageId is the thread root message)",
    write: true,
    parameters: obj(
      { issue: { type: "string" }, chatId: { type: "string" }, rootMessageId: { type: "string" } },
      ["issue", "chatId", "rootMessageId"],
    ),
    run: async ({ ctx }, a) => {
      const row = await createSyncThreadForIssue(ctx, {
        issueKey: a.issue,
        chatId: a.chatId,
        rootMessageId: a.rootMessageId,
      });
      return { issue: row?.linearIssueIdentifier, threadId: row?.feishuThreadId };
    },
  },
  {
    name: "linear_get_synced_thread",
    description: "Check whether a Linear issue is already synced with a Feishu thread",
    parameters: obj({ issueId: { type: "string", description: "Issue UUID" } }, ["issueId"]),
    run: async ({ ctx }, a) => {
      const t = await findByLinearIssue(ctx, a.issueId);
      return t ? { chatId: t.feishuChatId, threadId: t.feishuThreadId } : null;
    },
  },
];

export const mcpTools: ToolDef[] = [...linearTools, ...feishuTools];

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, any>;
}

const ok = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const err = (id: RpcRequest["id"], code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

/** 处理一条 JSON-RPC 消息；通知（无 id）返回 null */
export async function handleRpc(ctx: AppContext, req: RpcRequest) {
  const { id, method, params } = req;
  if (id === undefined || id === null) return null; // notifications/*

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: params?.protocolVersion ?? "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "feishu-linear", version: "0.4.0" },
        instructions:
          "Linear tools query and modify issues and projects; feishu_* tools read and send Feishu messages; linear_sync_feishu_thread syncs a Feishu thread with an issue.",
      });
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: mcpTools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.parameters,
        })),
      });
    case "tools/call": {
      const tool = mcpTools.find((t) => t.name === params?.name);
      if (!tool) return err(id, -32602, `Unknown tool ${params?.name}`);
      try {
        const out = await tool.run({ ctx }, params?.arguments ?? {});
        return ok(id, {
          content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 2) }],
        });
      } catch (e) {
        return ok(id, {
          isError: true,
          content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
        });
      }
    }
    default:
      return err(id, -32601, `Unsupported method ${method}`);
  }
}
