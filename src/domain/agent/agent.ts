import OpenAI from "openai";
import type { AppContext } from "../../app/context.js";
import * as feishu from "../../adapters/feishu/client.js";
import * as linearApi from "../../adapters/linear/api.js";
import { parseMessage, type Attachment } from "../messages/content.js";
import { getFeishuUserName, resolveLinearIdentity } from "../users/mapping.js";
import { buildGuidanceText, resolveChatDefaults } from "../settings/store.js";
import { linearTools, type ToolEnv } from "./tools.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("agent");

const SYSTEM_PROMPT = `你是 Linear 助手，运行在飞书群聊 / 私聊中，替用户直接操作 Linear。
能力：创建、查询、更新 Issue；评论；建立 Issue 关系；订阅；查看团队/项目/Initiative/成员/状态/标签/模板；创建文档；总结当前话题或群聊并据此建 Issue。
规则：
- 回复用简洁中文，可使用 Markdown；Issue 用 编号 + 标题 + 链接 的形式呈现。
- 「对话上下文」是此刻话题/群里最近的消息，用户说"这个""上面的"时指向它；据此提炼标题与描述，不要照搬整段聊天。
- 创建 Issue 时：团队/项目未指明则使用本群默认值；信息明显不足（没有任何可作标题的内容）才追问。
- 用户明确要求带上图片/文件时，create_issue 设 attachContextFiles=true；要求同步当前话题时设 syncThread=true。
- 写操作失败（例如用户未绑定 Linear 账号）要把原因告诉用户，不要假装成功。
- 不确定名称时先用 list_* 工具确认，不要编造团队、项目、状态名。`;

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
    log.warn({ err }, "读取对话上下文失败（需要 im:message.group_msg 权限）");
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
      m.senderType === "user" ? (names.get(m.senderId ?? "") ?? "用户") : "助手";
    const files = parsed.attachments.length
      ? ` [附件: ${parsed.attachments.map((a) => a.name).join("、")}]`
      : "";
    const text = parsed.text || (parsed.attachments.length ? "" : "[空]");
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
        description: "读取当前群聊/话题更早的消息（默认上下文不够时使用）",
        parameters: {
          type: "object",
          properties: { limit: { type: "number", description: "最多 50" } },
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
      "⚠️ AI 智能体未配置 OPENAI_API_KEY（管理员需在部署环境里设置）。",
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
    const defaultTeam = teams.find((t) => t.id === defaults.teamId)?.name;
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
      `## 当前环境
- 日期：${new Date().toISOString().slice(0, 10)}
- 会话：${input.chatType === "p2p" ? "私聊" : `群「${chatName}」`}${input.threadId ? "（话题内）" : ""}
- 本群默认团队：${defaultTeam ?? "未设置"}；默认项目：${defaultProject ?? "未设置（可按群名推断）"}
- 可用团队：${teams.map((t) => `${t.name}(${t.key})`).join("、")}
- 发起人：${input.senderName}，Linear 账号：${identity ? `${identity.linearName}（已绑定）` : "未绑定（写操作会失败，提示其私聊机器人 bind 邮箱）"}`,
      guidance && `## Guidance\n${guidance}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const images = await loadImages(ctx, allAttachments.filter((a) => a.messageId === input.messageId));
    const userText = [
      gathered.transcript && `## 对话上下文（旧→新）\n${gathered.transcript}`,
      `## 用户请求（${input.senderName}）\n${input.messageText || "（无文字，见附件）"}${
        allAttachments.length ? `\n（本次对话中有 ${allAttachments.length} 个图片/文件附件）` : ""
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
          result = `错误: ${err instanceof Error ? err.message : String(err)}`;
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content: result.slice(0, 12000) });
      }
      response = await call();
    }

    const text = response.choices[0]?.message?.content?.trim();
    await reply(text || "已处理。");
  } catch (err) {
    log.error({ err }, "Agent 处理失败");
    const timeout = err instanceof Error && (err.message === "__deadline__" || err.name === "TimeoutError");
    await reply(timeout ? "⏱ 处理超时了，请把需求拆小一点再试。" : "❌ 处理失败，请稍后重试。").catch(() => {});
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
  const tool = linearTools.find((t) => t.name === name);
  if (!tool) return `未知工具: ${name}`;
  const out = await tool.run(env, args);
  return typeof out === "string" ? out : JSON.stringify(out);
}
