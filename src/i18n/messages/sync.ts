import type { Catalog } from "./types.js";

/** 线程同步文案 */
export const sync = {
  "sync.attachmentTitle": { "zh-CN": "飞书同步线程 · {id}", en: "Feishu synced thread · {id}" },
  "sync.established": { "zh-CN": "🔗 已与 Linear {id} 建立同步", en: "🔗 Synced with Linear {id}" },
  "sync.noThreadId": {
    "zh-CN": "未能创建话题（回复未返回 thread_id）",
    en: "Could not create a thread (the reply returned no thread_id).",
  },
  "sync.fromFeishuPrefix": { "zh-CN": "**{name}**（来自飞书）：", en: "**{name}** (via Feishu):" },
  "sync.fromLinear": { "zh-CN": "💬 **{name}**（来自 Linear）", en: "💬 **{name}** (from Linear)" },
  "sync.statusChanged": { "zh-CN": "状态变更为 **{status}**", en: "status changed to **{status}**" },
  "sync.duplicate": { "zh-CN": "被标记为 **重复**", en: "was marked as **duplicate**" },
  "sync.done": { "zh-CN": "已 **完成**", en: "was **completed**" },
  "sync.canceled": { "zh-CN": "已 **取消**", en: "was **canceled**" },
  "sync.statusLine": {
    "zh-CN": "{emoji} Issue [{id}]({url}) {verb}（{actor}）",
    en: "{emoji} Issue [{id}]({url}) {verb} ({actor})",
  },
  "sync.dup.moved": {
    "zh-CN":
      "♻️ {id} 被 {actor} 标记为 [{original}]({url}) 的重复。此话题已改为与 **{original}** 同步。",
    en: "♻️ {id} was marked by {actor} as a duplicate of [{original}]({url}). This thread is now synced with **{original}**.",
  },
  "sync.dup.kept": {
    "zh-CN":
      "♻️ {id} 被 {actor} 标记为 [{original}]({url}) 的重复（原 Issue 已有同步线程，此话题保持原同步）。",
    en: "♻️ {id} was marked by {actor} as a duplicate of [{original}]({url}). The original issue already has a synced thread, so this thread keeps its current sync.",
  },
} satisfies Catalog;
