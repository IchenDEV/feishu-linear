import OpenAI from "openai";
import type { AppContext } from "../../app/context.js";
import * as feishu from "../../adapters/feishu/client.js";
import * as linearApi from "../../adapters/linear/api.js";
import { parseMessage, type Attachment } from "../messages/content.js";
import { getFeishuUserName, resolveLinearIdentity } from "../users/mapping.js";
import { buildGuidanceText, resolveChatDefaults } from "../settings/store.js";
import { linearTools, type ToolEnv } from "./tools.js";
import { currentLocale, t } from "../../i18n/index.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("agent");

const SYSTEM_PROMPT = `You are a Linear assistant running inside Feishu/Lark group chats and direct messages. You operate Linear on behalf of the user.
Capabilities: create, search and update issues; comment; relate issues; subscribe; browse teams, projects, initiatives, members, workflow states, labels and templates; create documents; summarize the current thread or channel and turn it into issues.
Rules:
- Reply concisely in the language the user wrote in (fall back to the "Preferred language" below). Markdown is allowed. Present issues as: key + title + link.
- "Conversation context" contains the most recent messages of the current thread/channel. When the user says "this" or "the above", it refers to that context. Distill a title and description from it instead of pasting the whole chat.
- When creating an issue: if team/project are not specified, use the channel defaults; only ask a follow-up when there is nothing at all that could serve as a title.
- When the user explicitly asks to include images/files, set attachContextFiles=true on create_issue; when they ask to sync the current thread, set syncThread=true.
- If a write fails (for example the user has not linked a Linear account), tell the user why. Never pretend it succeeded.
- When unsure about a name, confirm with the list_* tools first. Never invent teams, projects or workflow states.`;

const MAX_ITER = 8;
// Workers 的 waitUntil 响应后最多再给 30 秒，留出收尾时间
const DEADLINE_MS = () => (process.env.DB_MODE === "per-request" ? 26_000 : 120_000);

export interface AgentInput {
  chatId: string;
  chatType?: string;
  messageId: string;
  threadId?: string;
  senderOpenId: string;
  senderName: string;
  messageText: string;
  /** 触发消息自带的附件（图片 / 文件） */
  attachments?: Attachment[];
}

// ───────────────────────── 上下文 ─────────────────────────

interface Gathered {
  transcript: string;
  attachments: Attachment[];
}

async function gatherContext(ctx: AppContext, input: AgentInput): Promise<Gathered> {
  let msgs: feishu.FeishuMessage[] = [];
  try {
    msgs = await feishu.listMessages(
      ctx.lark,
      input.threadId
        ? { containerType: "thread", containerId: input.threadId, max: 30 }
        : { containerType: "chat", containerId: input.chatId, max: 15 },
    );
  } catch (err) {
    log.warn({ err }, "Failed to read the conversation context (requires the im:message.group_msg scope)");
  }
  msgs = msgs.filter((m) => !m.deleted && m.messageId !== input.messageId);

  const names = new Map<string, string>();
  for (const id of new Set(msgs.filter((m) => m.senderType === "user").map((m) => m.senderId))) {
    if (id) names.set(id, await getFeishuUserName(ctx, id, id));
  }

  const lines: string[] = [];
  const attachments: Attachment[] = [];
  for (const m of msgs) {
    const parsed = parseMessage(m.messageId, m.msgType, m.content);
    attachments.push(...parsed.attachments);
    const who =
      m.senderType === "user" ? (names.get(m.senderId ?? "") ?? t("agent.user")) : t("agent.assistant");
    const files = parsed.attachments.length
      ? ` [attachments: ${parsed.attachments.map((a) => a.name).join(", ")}]`
      : "";
    const text = parsed.text || (parsed.attachments.length ? "" : "[empty]");
    lines.push(`${who}: ${text}${files}`.slice(0, 1200));
  }
  return { transcript: lines.join("\n"), attachments: attachments.slice(-10) };
}

function sniffImageMime(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49) return "image/webp";
  return null;
}

async function loadImages(ctx: AppContext, atts: Attachment[]) {
  const out: Array<{ url: string }> = [];
  for (const a of atts.filter((x) => x.kind === "image").slice(0, 3)) {
    try {
      const data = await feishu.downloadMessageResource(ctx.lark, {
        messageId: a.messageId,
        fileKey: a.key,
        type: "image",
      });
      const mime = sniffImageMime(data);
      if (!mime || data.byteLength > 4 * 1024 * 1024) continue;
      out.push({ url: `data:${mime};base64,${Buffer.from(data).toString("base64")}` });
    } catch {
      /* 图片拿不到就忽略 */
    }
  }
  return out;
}

// ───────────────────────── 主流程 ─────────────────────────

function openaiTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    ...linearTools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    })),
    {
      type: "function" as const,
      function: {
        name: "read_more_chat_history",
        description: "Read earlier messages of the current chat/thread (use when the default context is not enough)",
        parameters: {
          type: "object",
          properties: { limit: { type: "number", description: "Maximum 50" } },
        },
      },
    },
  ];
}

export async function handleAgentMessage(ctx: AppContext, input: AgentInput) {
  const replyInThread = Boolean(input.threadId);
  const reply = (text: string) =>
    feishu.replyMarkdown(ctx.lark, input.messageId, text.slice(0, 6000), replyInThread);

  if (!ctx.config.OPENAI_API_KEY) {
    await feishu.replyText(
      ctx.lark,
      input.messageId,
      t("agent.notConfigured"),
    );
    return;
  }

  // 处理中提示：给触发消息打一个「输入中」表情，结束后摘掉
  let reactionId: string | undefined;
  try {
    const r = await feishu.addReaction(ctx.lark, input.messageId, "Typing");
    reactionId = (r.data as Record<string, any> | undefined)?.reaction_id;
  } catch {
    /* 表情失败不影响主流程 */
  }

  const deadline = Date.now() + DEADLINE_MS();
  try {
    const [gathered, guidance, defaults, identity] = await Promise.all([
      gatherContext(ctx, input),
      buildGuidanceText(ctx, input.chatId),
      resolveChatDefaults(ctx, input.chatId),
      resolveLinearIdentity(ctx, input.senderOpenId),
    ]);

    const linear = await ctx.getLinear();
    const [teams, projects] = await Promise.all([
      linearApi.getTeams(linear),
      defaults.projectId ? linearApi.getProjects(linear, 100) : Promise.resolve([]),
    ]);
    const defaultTeam = teams.find((tm) => tm.id === defaults.teamId)?.name;
    const defaultProject = projects.find((p) => p.id === defaults.projectId)?.name;
    let chatName = "";
    try {
      chatName = (await feishu.getChatInfo(ctx.lark, input.chatId)).name ?? "";
    } catch {
      /* 私聊没有群名 */
    }

    const allAttachments = [...(input.attachments ?? []), ...gathered.attachments];
    const system = [
      SYSTEM_PROMPT,
      `## Environment
- Date: ${new Date().toISOString().slice(0, 10)}
- Preferred language: ${currentLocale() === "en" ? "English" : "Simplified Chinese"}
- Conversation: ${input.chatType === "p2p" ? "direct message" : `channel "${chatName}"`}${input.threadId ? " (inside a thread)" : ""}
- Channel default team: ${defaultTeam ?? "not set"}; default project: ${defaultProject ?? "not set (may be inferred from the channel name)"}
- Available teams: ${teams.map((tm) => `${tm.name}(${tm.key})`).join(", ")}
- Requester: ${input.senderName}; Linear account: ${identity ? `${identity.linearName} (linked)` : "not linked (write operations will fail; tell them to run /linear bind <email> in a direct message)"}`,
      guidance && `## Guidance\n${guidance}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const images = await loadImages(ctx, allAttachments.filter((a) => a.messageId === input.messageId));
    const userText = [
      gathered.transcript && `## Conversation context (oldest → newest)\n${gathered.transcript}`,
      `## User request (${input.senderName})\n${input.messageText || "(no text; see attachments)"}${
        allAttachments.length ? `\n(${allAttachments.length} image/file attachment(s) in this conversation)` : ""
      }`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const openai = new OpenAI({
      apiKey: ctx.config.OPENAI_API_KEY,
      baseURL: ctx.config.OPENAI_BASE_URL,
    });

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      {
        role: "user",
        content: images.length
          ? [
              { type: "text", text: userText },
              ...images.map((i) => ({ type: "image_url" as const, image_url: i })),
            ]
          : userText,
      },
    ];

    const env: ToolEnv = {
      ctx,
      openId: input.senderOpenId,
      chatId: input.chatId,
      messageId: input.messageId,
      threadId: input.threadId,
      contextAttachments: allAttachments,
    };

    const call = async () => {
      const remaining = deadline - Date.now();
      if (remaining < 2000) throw new Error("__deadline__");
      return openai.chat.completions.create(
        {
          model: ctx.config.OPENAI_MODEL,
          messages,
          tools: openaiTools(),
          tool_choice: "auto",
        },
        { signal: AbortSignal.timeout(remaining) },
      );
    };

    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await call();
    } catch (err) {
      // 模型不支持图片输入时降级为纯文本
      if (images.length && (err as { status?: number }).status === 400) {
        messages[1] = { role: "user", content: userText };
        response = await call();
      } else {
        throw err;
      }
    }

    for (let i = 0; i < MAX_ITER && response.choices[0]?.finish_reason === "tool_calls"; i++) {
      const msg = response.choices[0].message;
      messages.push(msg);
      for (const tc of msg.tool_calls ?? []) {
        if (tc.type !== "function") continue;
        let result: string;
        try {
          const args = JSON.parse(tc.function.arguments || "{}");
          result = await runTool(env, tc.function.name, args);
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content: result.slice(0, 12000) });
      }
      response = await call();
    }

    const text = response.choices[0]?.message?.content?.trim();
    await reply(text || t("agent.done"));
  } catch (err) {
    log.error({ err }, "Agent run failed");
    const timeout = err instanceof Error && (err.message === "__deadline__" || err.name === "TimeoutError");
    await reply(timeout ? t("agent.timeout") : t("agent.failed")).catch(() => {});
  } finally {
    if (reactionId) {
      await feishu.removeReaction(ctx.lark, input.messageId, reactionId).catch(() => {});
    }
  }
}

async function runTool(env: ToolEnv, name: string, args: Record<string, unknown>): Promise<string> {
  if (name === "read_more_chat_history") {
    const limit = Math.min(Number(args.limit ?? 30), 50);
    const msgs = await feishu.listMessages(env.ctx.lark, {
      containerType: env.threadId ? "thread" : "chat",
      containerId: (env.threadId ?? env.chatId)!,
      max: limit,
    });
    return msgs
      .filter((m) => !m.deleted)
      .map((m) => parseMessage(m.messageId, m.msgType, m.content).text)
      .filter(Boolean)
      .join("\n")
      .slice(0, 10000);
  }
  const tool = linearTools.find((tl) => tl.name === name);
  if (!tool) return `Unknown tool: ${name}`;
  const out = await tool.run(env, args);
  return typeof out === "string" ? out : JSON.stringify(out);
}
