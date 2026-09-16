// 文本处理工具

// 从飞书消息内容中提取纯文本
export function extractTextFromFeishuContent(content: string, msgType: string): string {
  try {
    const parsed = JSON.parse(content);

    switch (msgType) {
      case "text":
        return parsed.text ?? "";

      case "post": {
        // 富文本消息
        const lines: string[] = [];
        const zhContent = parsed.zh_cn ?? parsed.en_us ?? parsed;
        if (zhContent?.title) lines.push(zhContent.title);
        if (zhContent?.content) {
          for (const paragraph of zhContent.content) {
            const parts: string[] = [];
            for (const element of paragraph) {
              if (element.tag === "text") parts.push(element.text);
              else if (element.tag === "a") parts.push(`[${element.text}](${element.href})`);
              else if (element.tag === "at") parts.push(`@${element.user_name ?? element.user_id}`);
            }
            lines.push(parts.join(""));
          }
        }
        return lines.join("\n");
      }

      case "interactive":
        return "[卡片消息]";

      default:
        return `[${msgType} 消息]`;
    }
  } catch {
    return content;
  }
}

// 检测消息中是否 @了机器人
export function isMentioningBot(content: string, botOpenId: string): boolean {
  try {
    const parsed = JSON.parse(content);
    if (parsed.text && typeof parsed.text === "string") {
      return parsed.text.includes(`@_user_${botOpenId}`) || parsed.text.includes("@_all");
    }
  } catch {}
  return false;
}

// 从消息文本中移除 @机器人 标记
export function removeBotMention(text: string): string {
  return text.replace(/@_user_\w+/g, "").replace(/\s+/g, " ").trim();
}

// 解析 Linear URL 提取 Issue/Project 信息
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

    // Issue URL: /org/issue/TEAM-123 或 /TEAM-123
    const issueMatch = parts.find((p) => /^[A-Z]+-\d+$/.test(p));
    if (issueMatch) {
      const [teamKey, num] = issueMatch.split("-");
      return {
        type: "issue",
        teamKey,
        identifier: issueMatch,
      };
    }

    // Project URL: /org/project/xxx
    if (parts.includes("project")) {
      const projectIdx = parts.indexOf("project");
      return {
        type: "project",
        id: parts[projectIdx + 1],
      };
    }

    // Document URL: /org/document/xxx
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

// 检测消息中的 Issue ID 提及（如 ENG-482）
export function detectIssueIdentifiers(text: string): string[] {
  const regex = /\b([A-Z]{2,10}-\d{1,6})\b/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    matches.push(match[1]);
  }
  return [...new Set(matches)];
}

// Markdown 转飞书富文本（简化版）
export function markdownToFeishuRichText(md: string): string {
  return md
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.*?)\*/g, "<i>$1</i>")
    .replace(/`(.*?)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}
