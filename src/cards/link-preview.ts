export function buildIssueLinkPreview(data: {
  identifier: string;
  title: string;
  description?: string;
  status: string;
  assignee?: string;
  createdAt: string;
  url: string;
}) {
  return {
    inline: {
      i18n_title: {
        zh_cn: `${data.identifier} ${data.title}`,
        en_us: `${data.identifier} ${data.title}`,
      },
    },
    card: {
      type: "raw",
      data: {
        schema: "2.0",
        config: { wide_screen_mode: true },
        header: {
          title: {
            tag: "plain_text",
            content: `${data.identifier} ${data.title}`,
          },
          template: "indigo",
        },
        body: {
          elements: [
            {
              tag: "div",
              fields: [
                {
                  is_short: true,
                  text: {
                    tag: "lark_md",
                    content: `**状态**\n${data.status}`,
                  },
                },
                {
                  is_short: true,
                  text: {
                    tag: "lark_md",
                    content: `**负责人**\n${data.assignee ?? "未分配"}`,
                  },
                },
              ],
            },
            ...(data.description
              ? [
                  { tag: "hr" },
                  {
                    tag: "markdown",
                    content:
                      data.description.length > 200
                        ? data.description.slice(0, 200) + "..."
                        : data.description,
                  },
                ]
              : []),
            {
              tag: "action",
              actions: [
                {
                  tag: "button",
                  text: { tag: "plain_text", content: "打开" },
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
              ],
            },
          ],
        },
      },
    },
  };
}

export function buildProjectLinkPreview(data: {
  name: string;
  description?: string;
  status: string;
  targetDate?: string;
  url: string;
}) {
  return {
    inline: {
      i18n_title: {
        zh_cn: `📁 ${data.name}`,
        en_us: `📁 ${data.name}`,
      },
    },
    card: {
      type: "raw",
      data: {
        schema: "2.0",
        config: { wide_screen_mode: true },
        header: {
          title: { tag: "plain_text", content: `📁 ${data.name}` },
          template: "turquoise",
        },
        body: {
          elements: [
            {
              tag: "div",
              fields: [
                {
                  is_short: true,
                  text: {
                    tag: "lark_md",
                    content: `**状态**\n${data.status}`,
                  },
                },
                ...(data.targetDate
                  ? [
                      {
                        is_short: true,
                        text: {
                          tag: "lark_md",
                          content: `**目标日期**\n${data.targetDate}`,
                        },
                      },
                    ]
                  : []),
              ],
            },
            {
              tag: "action",
              actions: [
                {
                  tag: "button",
                  text: { tag: "plain_text", content: "查看项目" },
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
      },
    },
  };
}
