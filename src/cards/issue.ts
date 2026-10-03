const STATUS_COLORS: Record<string, string> = {
  backlog: "grey",
  unstarted: "grey",
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

const PRIORITY_LABELS: Record<number, string> = {
  0: "无",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

export function getStatusColor(status: string): string {
  return STATUS_COLORS[status.toLowerCase()] ?? "indigo";
}

export function getPriorityLabel(priority: number): string {
  return PRIORITY_LABELS[priority] ?? String(priority);
}

export function buildIssueCard(data: {
  identifier: string;
  title: string;
  description?: string;
  status: string;
  assignee?: string;
  priority?: number;
  url: string;
  teamName: string;
  createdAt: string;
  labels?: string[];
}) {
  const desc = data.description
    ? data.description.length > 300
      ? data.description.slice(0, 300) + "..."
      : data.description
    : "";

  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      title: {
        tag: "plain_text",
        content: `${data.identifier} ${data.title}`,
      },
      template: getStatusColor(data.status),
    },
    body: {
      elements: [
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
                content: `**优先级**\n${getPriorityLabel(data.priority ?? 0)}`,
              },
            },
            {
              is_short: true,
              text: { tag: "lark_md", content: `**团队**\n${data.teamName}` },
            },
          ],
        },
        ...(desc
          ? [
              { tag: "hr" },
              {
                tag: "markdown",
                content: desc,
              },
            ]
          : []),
        ...(data.labels?.length
          ? [
              {
                tag: "markdown",
                content: `🏷 ${data.labels.map((l) => `\`${l}\``).join(" ")}`,
              },
            ]
          : []),
        { tag: "hr" },
        {
          tag: "action",
          actions: [
            {
              tag: "button",
              text: { tag: "plain_text", content: "在 Linear 中打开" },
              type: "primary",
              multi_url: {
                url: data.url,
                pc_url: data.url,
                android_url: data.url,
                ios_url: data.url,
              },
            },
            {
              tag: "button",
              text: { tag: "plain_text", content: "分配给我" },
              type: "default",
              behaviors: [
                {
                  type: "callback",
                  value: {
                    action: "assign_to_me",
                    issueId: data.identifier,
                  },
                },
              ],
            },
            {
              tag: "button",
              text: { tag: "plain_text", content: "订阅" },
              type: "default",
              behaviors: [
                {
                  type: "callback",
                  value: {
                    action: "subscribe_issue",
                    issueId: data.identifier,
                  },
                },
              ],
            },
          ],
        },
        {
          tag: "note",
          elements: [
            { tag: "plain_text", content: `创建于 ${data.createdAt}` },
          ],
        },
      ],
    },
  };
}

/** Card JSON 2.0 表单：创建 Issue */
export function buildCreateIssueForm(data: {
  teams: Array<{ id: string; name: string }>;
  defaultTitle?: string;
  chatId: string;
  messageId?: string;
  enableSync?: boolean;
}) {
  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "📝 创建 Linear Issue" },
      template: "blue",
    },
    body: {
      elements: [
        {
          tag: "form",
          name: "create_issue_form",
          elements: [
            {
              tag: "input",
              name: "title",
              required: true,
              placeholder: {
                tag: "plain_text",
                content: "Issue 标题",
              },
              default_value: data.defaultTitle?.slice(0, 200) ?? "",
            },
            {
              tag: "input",
              name: "description",
              placeholder: {
                tag: "plain_text",
                content: "描述（可选）",
              },
            },
            {
              tag: "select_static",
              name: "teamId",
              required: true,
              placeholder: { tag: "plain_text", content: "选择团队" },
              options: data.teams.map((t) => ({
                text: { tag: "plain_text", content: t.name },
                value: t.id,
              })),
              initial_option: data.teams[0]?.name,
            },
            {
              tag: "select_static",
              name: "priority",
              placeholder: { tag: "plain_text", content: "优先级（可选）" },
              options: [
                { text: { tag: "plain_text", content: "Urgent" }, value: "1" },
                { text: { tag: "plain_text", content: "High" }, value: "2" },
                { text: { tag: "plain_text", content: "Medium" }, value: "3" },
                { text: { tag: "plain_text", content: "Low" }, value: "4" },
              ],
            },
            {
              tag: "button",
              name: "submit_create",
              text: { tag: "plain_text", content: "创建 Issue" },
              type: "primary",
              form_action_type: "submit",
              behaviors: [
                {
                  type: "callback",
                  value: {
                    action: "submit_create_issue",
                    chatId: data.chatId,
                    messageId: data.messageId ?? "",
                    sync: false,
                  },
                },
              ],
            },
            ...(data.enableSync !== false
              ? [
                  {
                    tag: "button",
                    name: "submit_create_sync",
                    text: { tag: "plain_text", content: "创建并同步线程" },
                    type: "default",
                    form_action_type: "submit",
                    behaviors: [
                      {
                        type: "callback",
                        value: {
                          action: "submit_create_issue",
                          chatId: data.chatId,
                          messageId: data.messageId ?? "",
                          sync: true,
                        },
                      },
                    ],
                  },
                ]
              : []),
          ],
        },
      ],
    },
  };
}

export function buildIssueNotifyCard(data: {
  identifier: string;
  title: string;
  status: string;
  url: string;
  action: string;
  actor: string;
  detail?: string;
}) {
  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      title: {
        tag: "plain_text",
        content: `📋 ${data.action}: ${data.identifier} ${data.title}`.slice(
          0,
          100,
        ),
      },
      template: "blue",
    },
    body: {
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
          ? [{ tag: "markdown", content: data.detail }]
          : []),
        {
          tag: "action",
          actions: [
            {
              tag: "button",
              text: { tag: "plain_text", content: "查看详情" },
              type: "primary",
              multi_url: {
                url: data.url,
                pc_url: data.url,
                android_url: data.url,
                ios_url: data.url,
              },
            },
          ],
        },
      ],
    },
  };
}
