import * as lark from "@larksuiteoapi/node-sdk";
import type { Env } from "../../config.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("feishu-client");

export function createFeishuClient(config: Env): lark.Client {
  const client = new lark.Client({
    appId: config.FEISHU_APP_ID,
    appSecret: config.FEISHU_APP_SECRET,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.Feishu,
  });
  log.info("飞书客户端已初始化");
  return client;
}

export async function sendText(
  client: lark.Client,
  chatId: string,
  text: string,
) {
  return client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    },
  });
}

export async function sendCard(
  client: lark.Client,
  chatId: string,
  card: Record<string, unknown>,
) {
  return client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "interactive",
      content: JSON.stringify(card),
    },
  });
}

export async function sendP2PCard(
  client: lark.Client,
  openId: string,
  card: Record<string, unknown>,
) {
  return client.im.message.create({
    params: { receive_id_type: "open_id" },
    data: {
      receive_id: openId,
      msg_type: "interactive",
      content: JSON.stringify(card),
    },
  });
}

export async function replyText(
  client: lark.Client,
  messageId: string,
  text: string,
  replyInThread = false,
) {
  return client.im.message.reply({
    path: { message_id: messageId },
    data: {
      msg_type: "text",
      content: JSON.stringify({ text }),
      reply_in_thread: replyInThread,
    },
  });
}

/** 以富文本 post + md 标签回复，Markdown 能正常渲染（链接、加粗、代码块、列表） */
export async function replyMarkdown(
  client: lark.Client,
  messageId: string,
  markdown: string,
  replyInThread = false,
) {
  return client.im.message.reply({
    path: { message_id: messageId },
    data: {
      msg_type: "post",
      content: JSON.stringify({
        zh_cn: { content: [[{ tag: "md", text: markdown }]] },
      }),
      reply_in_thread: replyInThread,
    },
  });
}

export async function replyCard(
  client: lark.Client,
  messageId: string,
  card: Record<string, unknown>,
  replyInThread = false,
) {
  return client.im.message.reply({
    path: { message_id: messageId },
    data: {
      msg_type: "interactive",
      content: JSON.stringify(card),
      reply_in_thread: replyInThread,
    },
  });
}

export async function createGroup(
  client: lark.Client,
  name: string,
  description?: string,
  userIds?: string[],
  chatType: "public" | "private" = "public",
) {
  return client.im.chat.create({
    params: { user_id_type: "open_id" },
    data: {
      name,
      description,
      user_id_list: userIds,
      chat_mode: "group",
      chat_type: chatType,
    },
  });
}

export async function updateGroupName(
  client: lark.Client,
  chatId: string,
  name: string,
) {
  return client.im.chat.update({
    path: { chat_id: chatId },
    data: { name },
  });
}

export async function getMessage(client: lark.Client, messageId: string) {
  return client.im.message.get({
    path: { message_id: messageId },
  });
}

export async function getUser(
  client: lark.Client,
  openId: string,
) {
  return client.contact.user.get({
    path: { user_id: openId },
    params: { user_id_type: "open_id" },
  });
}

export async function batchGetUserIdByEmails(
  client: lark.Client,
  emails: string[],
) {
  return client.contact.user.batchGetId({
    params: { user_id_type: "open_id" },
    data: { emails },
  });
}

/** 生成飞书会话 AppLink，用于 Linear attachment */
export function feishuChatAppLink(chatId: string): string {
  return `https://applink.feishu.cn/client/chat/open?openChatId=${encodeURIComponent(chatId)}`;
}

// ───────────────────────── 消息读取 ─────────────────────────

export interface FeishuMessage {
  messageId: string;
  msgType: string;
  /** 原始 content JSON 字符串 */
  content: string;
  createTime?: number;
  senderId?: string;
  senderType?: string;
  threadId?: string;
  rootId?: string;
  parentId?: string;
  deleted?: boolean;
}

function toFeishuMessage(m: Record<string, any>): FeishuMessage {
  return {
    messageId: m.message_id,
    msgType: m.msg_type,
    content: m.body?.content ?? "",
    createTime: m.create_time ? Number(m.create_time) : undefined,
    senderId: m.sender?.id,
    senderType: m.sender?.sender_type,
    threadId: m.thread_id,
    rootId: m.root_id,
    parentId: m.parent_id,
    deleted: m.deleted,
  };
}

/** 读取话题 / 群聊的历史消息（升序）。最多 `max` 条 */
export async function listMessages(
  client: lark.Client,
  opts: {
    containerType: "thread" | "chat";
    containerId: string;
    max?: number;
  },
): Promise<FeishuMessage[]> {
  const out: FeishuMessage[] = [];
  let pageToken: string | undefined;
  const max = opts.max ?? 50;
  while (out.length < max) {
    const res = await client.im.message.list({
      params: {
        container_id_type: opts.containerType,
        container_id: opts.containerId,
        sort_type: opts.containerType === "chat" ? "ByCreateTimeDesc" : "ByCreateTimeAsc",
        page_size: Math.min(50, max - out.length),
        page_token: pageToken,
      },
    });
    const items = (res.data?.items ?? []) as Array<Record<string, any>>;
    out.push(...items.map(toFeishuMessage));
    if (!res.data?.has_more || !res.data.page_token) break;
    pageToken = res.data.page_token;
  }
  // 群聊按时间倒序取到的是「最近 N 条」，还原为升序
  return opts.containerType === "chat" ? out.reverse() : out;
}

/** 下载消息中的图片 / 文件资源 */
export async function downloadMessageResource(
  client: lark.Client,
  opts: { messageId: string; fileKey: string; type: "image" | "file" },
): Promise<Uint8Array> {
  const res = await client.im.messageResource.get({
    path: { message_id: opts.messageId, file_key: opts.fileKey },
    params: { type: opts.type },
  });
  const chunks: Uint8Array[] = [];
  for await (const c of res.getReadableStream()) {
    chunks.push(typeof c === "string" ? Buffer.from(c) : (c as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/** 上传图片（返回 image_key，可用于 image 消息 / 卡片） */
export async function uploadImage(client: lark.Client, data: Buffer) {
  const res = await client.im.image.create({
    data: { image_type: "message", image: data },
  });
  const key = res?.image_key;
  if (!key) throw new Error("飞书图片上传失败");
  return key;
}

/** 上传文件（返回 file_key，可用于 file 消息） */
export async function uploadFile(
  client: lark.Client,
  opts: { data: Buffer; fileName: string },
) {
  const res = await client.im.file.create({
    data: { file_type: "stream", file_name: opts.fileName, file: opts.data },
  });
  const key = res?.file_key;
  if (!key) throw new Error("飞书文件上传失败");
  return key;
}

export async function replyImage(
  client: lark.Client,
  messageId: string,
  imageKey: string,
  replyInThread = false,
) {
  return client.im.message.reply({
    path: { message_id: messageId },
    data: {
      msg_type: "image",
      content: JSON.stringify({ image_key: imageKey }),
      reply_in_thread: replyInThread,
    },
  });
}

export async function replyFile(
  client: lark.Client,
  messageId: string,
  fileKey: string,
  replyInThread = false,
) {
  return client.im.message.reply({
    path: { message_id: messageId },
    data: {
      msg_type: "file",
      content: JSON.stringify({ file_key: fileKey }),
      reply_in_thread: replyInThread,
    },
  });
}

// ───────────────────────── 卡片 / 互动 ─────────────────────────

/** 更新已发送的卡片内容（需 update_multi=true 的共享卡片） */
export async function patchCard(
  client: lark.Client,
  messageId: string,
  card: Record<string, unknown>,
) {
  return client.im.message.patch({
    path: { message_id: messageId },
    data: { content: JSON.stringify(card) },
  });
}

/**
 * 延时更新卡片（用卡片回调里的 token，30 分钟内、最多 2 次）。
 * 用于回调要求 3 秒内返回、但实际操作更慢的场景：先返回「处理中」，再异步更新结果。
 */
export async function updateCardByToken(
  client: lark.Client,
  token: string,
  card: Record<string, unknown>,
) {
  const res = await client.request({
    method: "POST",
    url: "/open-apis/interactive/v1/card/update",
    data: { token, card },
  });
  if (res?.code && res.code !== 0) {
    throw new Error(`延时更新卡片失败 code=${res.code} ${res.msg ?? ""}`);
  }
  return res;
}

/**
 * 发送仅指定用户可见的卡片（对标 Slack ephemeral）。
 * 仅支持普通群，不支持话题群 / 单聊；失败时调用方应回退为私聊卡片。
 */
export async function sendEphemeralCard(
  client: lark.Client,
  opts: { chatId: string; openId: string; card: Record<string, unknown> },
) {
  const res = await client.request({
    method: "POST",
    url: "/open-apis/ephemeral/v1/send",
    data: {
      chat_id: opts.chatId,
      open_id: opts.openId,
      msg_type: "interactive",
      card: opts.card,
    },
  });
  if (res?.code && res.code !== 0) {
    throw new Error(`临时卡片发送失败 code=${res.code} ${res.msg ?? ""}`);
  }
  return res;
}

export async function addReaction(
  client: lark.Client,
  messageId: string,
  emojiType: string,
) {
  return client.im.messageReaction.create({
    path: { message_id: messageId },
    data: { reaction_type: { emoji_type: emojiType } },
  });
}

export async function removeReaction(
  client: lark.Client,
  messageId: string,
  reactionId: string,
) {
  return client.im.messageReaction.delete({
    path: { message_id: messageId, reaction_id: reactionId },
  });
}

// ───────────────────────── 群 ─────────────────────────

export interface ChatInfo {
  name?: string;
  description?: string;
  /** 群聊模式：group / topic / p2p */
  chatMode?: string;
  /** public / private */
  chatType?: string;
  external?: boolean;
  ownerId?: string;
}

export async function getChatInfo(
  client: lark.Client,
  chatId: string,
): Promise<ChatInfo> {
  const res = await client.im.chat.get({
    path: { chat_id: chatId },
    params: { user_id_type: "open_id" },
  });
  const d = (res.data ?? {}) as Record<string, any>;
  return {
    name: d.name,
    description: d.description,
    chatMode: d.chat_mode,
    chatType: d.chat_type,
    external: d.external,
    ownerId: d.owner_id,
  };
}

/** 判断用户是否是群主 / 群管理员（用于管理类命令的权限判断） */
export async function isChatManager(
  client: lark.Client,
  chatId: string,
  openId: string,
): Promise<boolean> {
  try {
    const info = await getChatInfo(client, chatId);
    if (info.ownerId === openId) return true;
    const res = await client.request({
      method: "GET",
      url: `/open-apis/im/v1/chats/${chatId}/managers`,
      params: { member_id_type: "open_id" },
    });
    const ids = (res?.data?.chat_managers ?? res?.data?.chat_bot_managers ?? []) as string[];
    return ids.includes(openId);
  } catch {
    return false;
  }
}

export async function addChatMembers(
  client: lark.Client,
  chatId: string,
  openIds: string[],
) {
  if (!openIds.length) return;
  return client.im.chatMembers.create({
    path: { chat_id: chatId },
    params: { member_id_type: "open_id", succeed_type: 1 },
    data: { id_list: openIds },
  });
}

/** 在群里加一个 URL 标签页，用作指向 Linear 项目的回链「书签」 */
export async function addChatUrlTab(
  client: lark.Client,
  chatId: string,
  opts: { name: string; url: string },
) {
  return client.request({
    method: "POST",
    url: `/open-apis/im/v1/chats/${chatId}/chat_tabs`,
    data: {
      chat_tabs: [
        {
          tab_name: opts.name.slice(0, 30),
          tab_type: "url",
          tab_content: { url: opts.url },
        },
      ],
    },
  });
}

/** 置顶一条消息（回链消息） */
export async function pinMessage(client: lark.Client, messageId: string) {
  return client.im.pin.create({ data: { message_id: messageId } });
}

// ───────────────────────── 用户 ─────────────────────────

/** 取用户邮箱 / 姓名（需要 contact 权限；拿不到返回空） */
export async function getUserProfile(client: lark.Client, openId: string) {
  try {
    const res = await getUser(client, openId);
    const u = (res.data as Record<string, any>)?.user ?? {};
    return {
      name: u.name as string | undefined,
      email: (u.email || u.enterprise_email) as string | undefined,
      unionId: u.union_id as string | undefined,
    };
  } catch {
    return { name: undefined, email: undefined, unionId: undefined };
  }
}
