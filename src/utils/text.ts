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

export function parseLinearUrl(url: string): {
  type: "issue" | "project" | "document" | "unknown";
  teamKey?: string;
  identifier?: string;
  id?: string;
} | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("linear.app")) return null;

    const parts = parsed.pathname.split("/").filter(Boolean);
    const issueMatch = parts.find((p) => /^[A-Z]+-\d+$/.test(p));
    if (issueMatch) {
      const [teamKey] = issueMatch.split("-");
      return { type: "issue", teamKey, identifier: issueMatch };
    }

    if (parts.includes("project")) {
      return {
        type: "project",
        id: parts[parts.indexOf("project") + 1],
      };
    }

    if (parts.includes("document")) {
      return {
        type: "document",
        id: parts[parts.indexOf("document") + 1],
      };
    }

    return { type: "unknown" };
  } catch {
    return null;
  }
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
