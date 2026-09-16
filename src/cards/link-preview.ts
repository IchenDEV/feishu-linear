// 飞书链接预览卡片 —— Linear URL 展开

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
        config: { wide_screen_mode: true },
        header: {
          title: {
            tag: "plain_text",
            content: `${data.identifier} ${data.title}`,
          },
          template: "indigo",
        },
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
                  tag: "div",
                  text: {
                    tag: "lark_md",
                    content:
                      data.description.length > 200
                        ? data.description.slice(0, 200) + "..."
                        : data.description,
                  },
                },
              ]
            : []),
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
                  action: "assign_to_me_from_preview",
                  issueId: data.identifier,
                }),
              },
            ],
          },
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
        config: { wide_screen_mode: true },
        header: {
          title: { tag: "plain_text", content: `📁 ${data.name}` },
          template: "turquoise",
        },
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
          ...(data.description
            ? [
                { tag: "hr" },
                {
                  tag: "div",
                  text: {
                    tag: "lark_md",
                    content:
                      data.description.length > 200
                        ? data.description.slice(0, 200) + "..."
                        : data.description,
                  },
                },
              ]
            : []),
          {
            tag: "action",
            actions: [
              {
                tag: "button",
                text: { tag: "plain_text", content: "查看项目" },
                url: data.url,
                type: "primary",
              },
            ],
          },
        ],
      },
    },
  };
}
