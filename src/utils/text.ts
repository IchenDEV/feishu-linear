/** 从飞书消息 content JSON 提取纯文本 */
export function extractTextFromFeishuContent(
  content: string,
  messageType: string,
): string {
  try {
    const parsed = JSON.parse(content);

    switch (messageType) {
      case "text":
        return parsed.text ?? "";

      case "post": {
        const lines: string[] = [];
        const zhContent = parsed.zh_cn ?? parsed.en_us ?? parsed;
        if (zhContent?.title) lines.push(zhContent.title);
        if (zhContent?.content) {
          for (const paragraph of zhContent.content) {
            const parts: string[] = [];
            for (const element of paragraph) {
              if (element.tag === "text") parts.push(element.text);
              else if (element.tag === "a")
                parts.push(`[${element.text}](${element.href})`);
              else if (element.tag === "at")
                parts.push(`@${element.user_name ?? element.user_id}`);
            }
            lines.push(parts.join(""));
          }
        }
        return lines.join("\n");
      }

      case "interactive":
        return "[卡片消息]";

      default:
        return `[${messageType} 消息]`;
    }
  } catch {
    return content;
  }
}

/** 移除消息中的 @_user_N 提及标记 */
export function removeMentions(text: string): string {
  return text.replace(/@_user_\d+/g, "").replace(/\s+/g, " ").trim();
}

export type LinearUrlKind = "issue" | "project" | "document" | "initiative" | "unknown";

export function parseLinearUrl(url: string): {
  type: LinearUrlKind;
  teamKey?: string;
  identifier?: string;
  /** URL 中的 slug（如 `my-project-a1b2c3d4e5f6`） */
  id?: string;
} | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "linear.app" && !parsed.hostname.endsWith(".linear.app")) return null;

    const parts = parsed.pathname.split("/").filter(Boolean);
    const issueMatch = parts.find((p) => /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(p));
    if (issueMatch && parts[parts.indexOf(issueMatch) - 1] === "issue") {
      const [teamKey] = issueMatch.split("-");
      return { type: "issue", teamKey, identifier: issueMatch.toUpperCase() };
    }
    for (const kind of ["project", "document", "initiative"] as const) {
      const at = parts.indexOf(kind);
      if (at >= 0 && parts[at + 1]) return { type: kind, id: parts[at + 1] };
    }
    return { type: "unknown" };
  } catch {
    return null;
  }
}

/** slug 末尾的 12 位 slugId（Linear 的项目 / 文档 / Initiative URL 形如 name-<slugId>） */
export function slugTail(slug: string): string {
  return slug.split("-").pop() ?? slug;
}

export function detectIssueIdentifiers(text: string): string[] {
  const regex = /\b([A-Z]{2,10}-\d{1,6})\b/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    matches.push(match[1]);
  }
  return [...new Set(matches)];
}

export interface FeishuMention {
  key: string;
  openId?: string;
  mentionedType?: string;
  name?: string;
}

/** 判断消息是否 @了机器人（用 mentioned_type，而非猜测 open_id 前缀） */
export function isBotMentioned(
  mentions: FeishuMention[] | undefined,
): boolean {
  if (!mentions?.length) return false;
  return mentions.some((m) => m.mentionedType === "bot");
}
