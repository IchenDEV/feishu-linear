import type { AppContext } from "../../app/context.js";
import * as feishu from "../../adapters/feishu/client.js";
import { parseMessage, type ParsedMessage } from "./content.js";
import { getFeishuUserName } from "../users/mapping.js";

export interface SourceMessage extends ParsedMessage {
  messageId: string;
  chatId?: string;
  threadId?: string;
  senderOpenId?: string;
  senderName?: string;
  msgType: string;
}

/** 读取一条飞书消息并解析成 Markdown + 附件（含 @ 提及名） */
export async function fetchSourceMessage(
  ctx: AppContext,
  messageId: string,
): Promise<SourceMessage | null> {
  try {
    const res = await feishu.getMessage(ctx.lark, messageId);
    const m = (res.data?.items?.[0] ?? undefined) as Record<string, any> | undefined;
    if (!m) return null;
    const names: Record<string, string> = {};
    for (const mention of m.mentions ?? []) {
      if (mention.key) names[mention.key] = mention.name;
    }
    const parsed = parseMessage(messageId, m.msg_type, m.body?.content ?? "", names);
    const senderOpenId = m.sender?.sender_type === "user" ? m.sender?.id : undefined;
    return {
      ...parsed,
      messageId,
      msgType: m.msg_type,
      chatId: m.chat_id,
      threadId: m.thread_id,
      senderOpenId,
      senderName: senderOpenId ? await getFeishuUserName(ctx, senderOpenId) : undefined,
    };
  } catch {
    return null;
  }
}

/** 取标题：第一行非空文本，最多 80 字 */
export function deriveTitle(text: string, fallback = "来自飞书的消息"): string {
  const line = text
    .split("\n")
    .map((s) => s.trim())
    .find(Boolean);
  if (!line) return fallback;
  const plain = line.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/[*_`#>]/g, "").trim();
  return (plain || fallback).slice(0, 80);
}
