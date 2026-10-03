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
