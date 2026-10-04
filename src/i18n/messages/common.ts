import type { Catalog } from "./types.js";

/** H5 页面（消息快捷操作）与通用提示 */
export const common = {
  "h5.title": { "zh-CN": "转为 Linear Issue", en: "Convert to Linear issue" },
  "h5.connecting": { "zh-CN": "正在连接飞书…", en: "Connecting to Feishu…" },
  "h5.errorPrefix": { "zh-CN": "出错了：", en: "Something went wrong: " },
  "h5.openInFeishu": { "zh-CN": "请在飞书客户端内打开。", en: "Please open this page inside the Feishu client." },
  "h5.enterFromMenu": {
    "zh-CN": "请从消息的「更多 → 转为 Linear Issue」进入。",
    en: "Open this page from a message’s “More → Convert to Linear issue” menu.",
  },
  "h5.reading": { "zh-CN": "正在读取消息…", en: "Reading messages…" },
  "h5.none": { "zh-CN": "（无）", en: "(none)" },
  "h5.attachments": {
    "zh-CN": "包含 {n} 个图片/文件，将一并上传到 Issue。",
    en: "Includes {n} image/file attachment(s) that will be uploaded to the issue.",
  },
  "h5.team": { "zh-CN": "团队", en: "Team" },
  "h5.titleLabel": { "zh-CN": "标题", en: "Title" },
  "h5.description": { "zh-CN": "描述", en: "Description" },
  "h5.project": { "zh-CN": "项目", en: "Project" },
  "h5.status": { "zh-CN": "状态", en: "Status" },
  "h5.priority": { "zh-CN": "优先级", en: "Priority" },
  "h5.template": { "zh-CN": "模板", en: "Template" },
  "h5.labels": { "zh-CN": "标签", en: "Labels" },
  "h5.sync": {
    "zh-CN": "同步此话题（回复 ↔ Issue 评论）",
    en: "Sync this thread (replies ↔ issue comments)",
  },
  "h5.create": { "zh-CN": "创建 Issue", en: "Create issue" },
  "h5.creating": { "zh-CN": "创建中…", en: "Creating…" },
  "h5.created": { "zh-CN": "✅ 已创建", en: "✅ Created" },
  "h5.synced": { "zh-CN": "（已同步话题）", en: " (thread synced)" },
  "h5.openInLinear": { "zh-CN": "在 Linear 中打开", en: "Open in Linear" },
  "h5.close": { "zh-CN": "关闭", en: "Close" },

  "h5.error.expired": { "zh-CN": "登录已过期，请重新打开", en: "Your session has expired. Please reopen this page." },
  "h5.error.badUrl": { "zh-CN": "url 不合法", en: "Invalid url." },
  "h5.error.noCode": { "zh-CN": "缺少 code", en: "Missing code." },
  "h5.error.noMessages": { "zh-CN": "没有读取到消息", en: "No messages were received." },
  "h5.error.missingFields": { "zh-CN": "缺少标题或消息", en: "A title and at least one message are required." },
} satisfies Catalog;
