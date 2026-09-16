// 飞书卡片模板 —— Issue 信息展示 & 交互

interface IssueCardData {
  identifier: string;
  title: string;
  description?: string;
  status: string;
  statusColor: string;
  assignee?: string;
  priority?: string;
  priorityIcon: string;
  url: string;
  teamName: string;
  createdAt: string;
  labels?: string[];
}

// Issue 状态颜色映射
const STATUS_COLORS: Record<string, string> = {
  backlog: "neutral",
  unstarted: "neutral",
  started: "blue",
  "in progress": "blue",
  "in review": "purple",
  done: "green",
  completed: "green",
  cancelled: "red",
  canceled: "red",
  duplicate: "orange",
  triage: "yellow",
};

// 优先级图标
const PRIORITY_ICONS: Record<number, string> = {
  0: "⏸️",
  1: "🔴",
  2: "🟠",
  3: "🟡",
  4: "🔵",
};

export function getStatusColor(status: string): string {
  return STATUS_COLORS[status.toLowerCase()] ?? "neutral";
}

export function getPriorityIcon(priority: number): string {
  return PRIORITY_ICONS[priority] ?? "⏸️";
}

export function buildIssueCard(data: IssueCardData) {
  const labelTags = data.labels?.length
    ? data.labels.map((l) => `\`${l}\``).join(" ")
    : "";

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: `${data.identifier} ${data.title}` },
      template: data.statusColor === "green" ? "green" : data.statusColor === "blue" ? "blue" : "indigo",
    },
    elements: [
      // 状态行
      {
        tag: "div",
        fields: [
          {
            is_short: true,
            text: { tag: "lark_md", content: `**状态**\n${data.status}` },
          },
          {
            is_short: true,
            text: {
              tag: "lark_md",
              content: `**负责人**\n${data.assignee ?? "未分配"}`,
            },
          },
          {
            is_short: true,
            text: {
              tag: "lark_md",
              content: `**优先级**\n${data.priorityIcon} ${data.priority ?? "无"}`,
            },
          },
          {
            is_short: true,
            text: { tag: "lark_md", content: `**团队**\n${data.teamName}` },
          },
        ],
      },
      // 描述
      ...(data.description
        ? [
            { tag: "hr" },
            {
              tag: "div",
              text: {
                tag: "lark_md",
                content:
                  data.description.length > 300
                    ? data.description.slice(0, 300) + "..."
                    : data.description,
              },
            },
          ]
        : []),
      // 标签
      ...(labelTags
        ? [
            {
              tag: "div",
              text: { tag: "lark_md", content: `🏷 ${labelTags}` },
            },
          ]
        : []),
      { tag: "hr" },
      // 操作按钮行
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "在 Linear 中打开" },
            url: data.url,
            type: "primary",
          },
          {
            tag: "button",
            text: { tag: "plain_text", content: "分配给我" },
            type: "default",
            value: JSON.stringify({
              action: "assign_to_me",
              issueId: data.identifier,
            }),
          },
          {
            tag: "button",
            text: { tag: "plain_text", content: "评论" },
            type: "default",
            value: JSON.stringify({
              action: "add_comment",
              issueId: data.identifier,
            }),
          },
        ],
      },
      // 底部信息
      {
        tag: "note",
        elements: [
          {
            tag: "plain_text",
            content: `创建于 ${data.createdAt}`,
          },
        ],
      },
    ],
  };
}

// 简版 Issue 卡片 —— 用于通知
export function buildIssueNotifyCard(data: {
  identifier: string;
  title: string;
  status: string;
  assignee?: string;
  url: string;
  action: string; // "创建", "更新", "完成", "评论"
  actor: string;
  detail?: string;
}) {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: {
        tag: "plain_text",
        content: `📋 ${data.action}: ${data.identifier} ${data.title}`,
      },
      template: "blue",
    },
    elements: [
      {
        tag: "div",
        fields: [
          {
            is_short: true,
            text: { tag: "lark_md", content: `**操作者**\n${data.actor}` },
          },
          {
            is_short: true,
            text: { tag: "lark_md", content: `**状态**\n${data.status}` },
          },
        ],
      },
      ...(data.detail
        ? [
            {
              tag: "div",
              text: { tag: "lark_md", content: data.detail },
            },
          ]
        : []),
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "查看详情" },
            url: data.url,
            type: "primary",
          },
        ],
      },
    ],
  };
}

// Issue 创建表单卡片
export function buildCreateIssueFormCard(data: {
  teams: Array<{ id: string; name: string }>;
  messagePreview?: string;
  chatId: string;
  messageId: string;
}) {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "📝 创建 Linear Issue" },
      template: "blue",
    },
    elements: [
      // 来源消息预览
      ...(data.messagePreview
        ? [
            {
              tag: "div",
              text: {
                tag: "lark_md",
                content: `> 来源消息: ${data.messagePreview.slice(0, 200)}`,
              },
            },
            { tag: "hr" },
          ]
        : []),
      // 团队选择
      {
        tag: "action",
        actions: [
          {
            tag: "select_static",
            placeholder: { tag: "plain_text", content: "选择团队" },
            options: data.teams.map((t) => ({
              text: { tag: "plain_text", content: t.name },
              value: t.id,
            })),
            value: JSON.stringify({
              action: "select_team",
              chatId: data.chatId,
              messageId: data.messageId,
            }),
          },
        ],
      },
      // 标题输入（通过 input 组件）
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: "请在下方输入 Issue 标题，或直接点击「快速创建」使用消息内容作为标题",
        },
      },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "快速创建" },
            type: "primary",
            value: JSON.stringify({
              action: "quick_create_issue",
              chatId: data.chatId,
              messageId: data.messageId,
            }),
          },
          {
            tag: "button",
            text: { tag: "plain_text", content: "创建并同步线程" },
            type: "default",
            value: JSON.stringify({
              action: "create_issue_with_sync",
              chatId: data.chatId,
              messageId: data.messageId,
            }),
          },
        ],
      },
    ],
  };
}
