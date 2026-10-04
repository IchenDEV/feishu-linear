import type { AppContext } from "../../app/context.js";
import * as feishu from "../../adapters/feishu/client.js";
import * as linearApi from "../../adapters/linear/api.js";
import { createChildLogger } from "../../logger.js";
import { t } from "../../i18n/index.js";

const log = createChildLogger("message-content");

export interface Attachment {
  kind: "image" | "file" | "media" | "audio";
  /** image_key / file_key */
  key: string;
  name: string;
  /** 附件所属消息，用于下载资源 */
  messageId: string;
}

export interface ParsedMessage {
  /** Markdown 文本（保留链接、@、代码块） */
  text: string;
  attachments: Attachment[];
}

type MentionNames = Record<string, string>;

function applyMentionNames(text: string, names?: MentionNames): string {
  if (!names) return text;
  return text.replace(/@_user_\d+/g, (k) => (names[k] ? `@${names[k]}` : k));
}

/** 解析Feishu message content（text / post / image / file / media / audio 等）为 Markdown + 附件 */
export function parseMessage(
  messageId: string,
  msgType: string,
  content: string,
  mentionNames?: MentionNames,
): ParsedMessage {
  let c: any;
  try {
    c = JSON.parse(content);
  } catch {
    return { text: content, attachments: [] };
  }
  const attachments: Attachment[] = [];

  switch (msgType) {
    case "text":
      return {
        text: applyMentionNames(String(c.text ?? ""), mentionNames),
        attachments,
      };

    case "post": {
      const body = c.zh_cn ?? c.en_us ?? c.ja_jp ?? c;
      const lines: string[] = [];
      if (body?.title) lines.push(`**${body.title}**`);
      for (const paragraph of body?.content ?? []) {
        const parts: string[] = [];
        for (const el of paragraph ?? []) {
          switch (el.tag) {
            case "text":
              parts.push(el.text ?? "");
              break;
            case "a":
              parts.push(`[${el.text ?? el.href}](${el.href})`);
              break;
            case "at":
              parts.push(`@${el.user_name ?? mentionNames?.[el.user_id] ?? el.user_id}`);
              break;
            case "img":
              attachments.push({
                kind: "image",
                key: el.image_key,
                name: `image-${attachments.length + 1}.png`,
                messageId,
              });
              break;
            case "media":
              attachments.push({
                kind: "media",
                key: el.file_key,
                name: el.file_name ?? `media-${attachments.length + 1}`,
                messageId,
              });
              break;
            case "code_block":
              parts.push(`\n\`\`\`${el.language ?? ""}\n${el.text ?? ""}\n\`\`\`\n`);
              break;
            case "hr":
              parts.push("\n---\n");
              break;
            case "emotion":
              parts.push(`:${el.emoji_type}:`);
              break;
          }
        }
        lines.push(parts.join(""));
      }
      return { text: lines.join("\n").trim(), attachments };
    }

    case "image":
      attachments.push({
        kind: "image",
        key: c.image_key,
        name: "image.png",
        messageId,
      });
      return { text: "", attachments };

    case "file":
      attachments.push({
        kind: "file",
        key: c.file_key,
        name: c.file_name ?? "file",
        messageId,
      });
      return { text: "", attachments };

    case "media":
      attachments.push({
        kind: "media",
        key: c.file_key,
        name: c.file_name ?? "video.mp4",
        messageId,
      });
      return { text: "", attachments };

    case "audio":
      attachments.push({
        kind: "audio",
        key: c.file_key,
        name: "audio.opus",
        messageId,
      });
      return { text: "", attachments };

    case "interactive":
      return { text: t("content.card"), attachments };
    case "merge_forward":
      return { text: t("content.merged"), attachments };
    case "sticker":
      return { text: t("content.sticker"), attachments };
    default:
      return { text: t("content.other", { type: msgType }), attachments };
  }
}

const MAX_FILES = 10;
const MAX_BYTES = 20 * 1024 * 1024;

function guessContentType(att: Attachment): string {
  if (att.kind === "image") return "image/png";
  const ext = att.name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    mp4: "video/mp4",
    mov: "video/quicktime",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    zip: "application/zip",
    opus: "audio/ogg",
  };
  return (ext && map[ext]) || "application/octet-stream";
}

/**
 * 把Feishu message里的图片 / 文件上传到 Linear，返回 Markdown 片段。
 * 单个失败不影响其余附件（返回提示行）。
 */
export async function uploadAttachmentsToLinear(
  ctx: AppContext,
  attachments: Attachment[],
): Promise<string[]> {
  if (!attachments.length) return [];
  const linear = await ctx.getLinear();
  const out: string[] = [];
  for (const att of attachments.slice(0, MAX_FILES)) {
    try {
      const data = await feishu.downloadMessageResource(ctx.lark, {
        messageId: att.messageId,
        fileKey: att.key,
        type: att.kind === "image" ? "image" : "file",
      });
      if (data.byteLength > MAX_BYTES) {
        out.push(t("content.tooLarge", { name: att.name }));
        continue;
      }
      const url = await linearApi.uploadFile(linear, {
        data,
        filename: att.name,
        contentType: guessContentType(att),
      });
      out.push(att.kind === "image" ? `![${att.name}](${url})` : `[${att.name}](${url})`);
    } catch (err) {
      log.warn({ err, att: att.name }, "Failed to upload the attachment to Linear");
      out.push(t("content.uploadFailed", { name: att.name }));
    }
  }
  if (attachments.length > MAX_FILES) {
    out.push(t("content.tooMany", { max: MAX_FILES }));
  }
  return out;
}

// ───────────────────────── Linear → 飞书 ─────────────────────────

const MD_IMAGE = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const MD_LINEAR_FILE = /\[([^\]]+)\]\((https:\/\/uploads\.linear\.app\/[^)\s]+)\)/g;

export interface LinearAsset {
  kind: "image" | "file";
  url: string;
  name: string;
}

/** 从 Linear Markdown 中提取需要转发到飞书的图片 / 上传文件，并返回去掉它们的正文 */
export function extractLinearAssets(markdown: string): {
  text: string;
  assets: LinearAsset[];
} {
  const assets: LinearAsset[] = [];
  let text = markdown.replace(MD_IMAGE, (_m, alt: string, url: string) => {
    assets.push({ kind: "image", url, name: alt || "image" });
    return "";
  });
  text = text.replace(MD_LINEAR_FILE, (_m, name: string, url: string) => {
    assets.push({ kind: "file", url, name });
    return `📎 ${name}`;
  });
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), assets };
}

/** 下载 Linear 资源（uploads.linear.app 需要鉴权头） */
export async function downloadLinearAsset(
  ctx: AppContext,
  url: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  try {
    const headers: Record<string, string> = {};
    if (new URL(url).hostname.endsWith("linear.app")) {
      headers.Authorization = await ctx.getLinearAuthHeader();
    }
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return null;
    return { data: buf, contentType: res.headers.get("content-type") ?? "" };
  } catch (err) {
    log.warn({ err, url }, "Failed to download the Linear asset");
    return null;
  }
}
