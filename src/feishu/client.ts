import * as lark from "@larksuiteoapi/node-sdk";
import type { Env } from "../config.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("feishu");

let _client: lark.Client | null = null;

export function getFeishuClient(config: Env): lark.Client {
  if (_client) return _client;

  _client = new lark.Client({
    appId: config.FEISHU_APP_ID,
    appSecret: config.FEISHU_APP_SECRET,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.Feishu,
  });

  log.info("飞书客户端已初始化");
  return _client;
}

// ── 消息发送 ──

export async function sendTextMessage(
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

export async function sendCardMessage(
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

export async function replyMessage(
  client: lark.Client,
  messageId: string,
  content: string,
  msgType: string = "text",
  replyInThread: boolean = false,
) {
  return client.im.message.reply({
    path: { message_id: messageId },
    data: {
      msg_type: msgType,
      content,
      reply_in_thread: replyInThread,
    },
  });
}

export async function replyWithCard(
  client: lark.Client,
  messageId: string,
  card: Record<string, unknown>,
  replyInThread: boolean = false,
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

export async function sendP2PMessage(
  client: lark.Client,
  openId: string,
  text: string,
) {
  return client.im.message.create({
    params: { receive_id_type: "open_id" },
    data: {
      receive_id: openId,
      msg_type: "text",
      content: JSON.stringify({ text }),
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

// ── 群组管理 ──

export async function createGroup(
  client: lark.Client,
  name: string,
  description?: string,
  userIds?: string[],
) {
  return client.im.chat.create({
    params: { user_id_type: "open_id" },
    data: {
      name,
      description,
      user_id_list: userIds,
      chat_mode: "group",
      chat_type: "public",
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

export async function addMembersToGroup(
  client: lark.Client,
  chatId: string,
  openIds: string[],
) {
  return client.im.chatMembers.create({
    path: { chat_id: chatId },
    params: { member_id_type: "open_id" },
    data: { id_list: openIds },
  });
}

// ── 会话历史消息 ──

export async function getThreadMessages(
  client: lark.Client,
  threadId: string,
  pageToken?: string,
) {
  return client.im.message.list({
    params: {
      container_id_type: "thread",
      container_id: threadId,
      page_size: 50,
      page_token: pageToken,
    },
  });
}

export async function getMessage(
  client: lark.Client,
  messageId: string,
) {
  return client.im.message.get({
    path: { message_id: messageId },
  });
}
