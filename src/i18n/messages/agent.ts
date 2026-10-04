import type { Catalog } from "./types.js";

/** AI 智能体面向用户的提示语（系统提示词与工具描述为英文，不在此处） */
export const agent = {
  "agent.notConfigured": {
    "zh-CN": "⚠️ AI 智能体未配置 OPENAI_API_KEY（管理员需在部署环境里设置）。",
    en: "⚠️ The AI agent is not configured: OPENAI_API_KEY is missing (an administrator needs to set it in the deployment environment).",
  },
  "agent.done": { "zh-CN": "已处理。", en: "Done." },
  "agent.timeout": {
    "zh-CN": "⏱ 处理超时了，请把需求拆小一点再试。",
    en: "⏱ That took too long. Please try again with a smaller request.",
  },
  "agent.failed": { "zh-CN": "❌ 处理失败，请稍后重试。", en: "❌ Something went wrong. Please try again later." },
  "agent.user": { "zh-CN": "用户", en: "User" },
  "agent.assistant": { "zh-CN": "助手", en: "Assistant" },
} satisfies Catalog;
