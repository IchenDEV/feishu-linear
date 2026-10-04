import {
  button,
  card,
  clip,
  fields,
  form,
  hr,
  input,
  md,
  note,
  personPicker,
  row,
  select,
  type CardElement,
} from "./kit.js";

const STATUS_TEMPLATE: Record<string, string> = {
  triage: "yellow",
  backlog: "grey",
  unstarted: "grey",
  started: "blue",
  completed: "green",
  canceled: "red",
};

const PRIORITY_LABELS: Record<number, string> = {
  0: "无优先级",
  1: "🔴 Urgent",
  2: "🟠 High",
  3: "🟡 Medium",
  4: "🔵 Low",
};

export function getPriorityLabel(priority: number): string {
  return PRIORITY_LABELS[priority] ?? String(priority);
}

export function statusTemplate(statusType?: string, statusName?: string): string {
  if (statusType && STATUS_TEMPLATE[statusType]) return STATUS_TEMPLATE[statusType];
  if (/duplicate/i.test(statusName ?? "")) return "orange";
  return "indigo";
}

// ───────────────────────── Issue ─────────────────────────

export interface IssueCardData {
  identifier: string;
  title: string;
  description?: string;
  status: string;
  statusType?: string;
  assignee?: string;
  priority?: number;
  url: string;
  teamName: string;
  projectName?: string;
  labels?: string[];
  dueDate?: string;
  creator?: string;
  createdAt: string;
  /** 已同步线程 */
  synced?: boolean;
}

export interface IssueCardContext {
  /** 卡片所属会话与触发消息，用于「升级为同步线程」 */
  chatId?: string;
  messageId?: string;
  threadId?: string;
}

/**
 * 完整 Issue 卡片（对标 Slack 的 Issue 展开）：
 * 信息 + 改负责人 + 订阅/取消订阅 + 评论 + 升级为同步线程。
 */
export function buildIssueCard(
  data: IssueCardData,
  c: IssueCardContext = {},
): Record<string, unknown> {
  // 回调带上会话上下文，操作后才能原地刷新卡片（含「同步此线程」按钮）
  const base = {
    issueId: data.identifier,
    chatId: c.chatId ?? "",
    messageId: c.messageId ?? "",
    threadId: c.threadId ?? "",
  };
  const elements: CardElement[] = [
    fields([
      ["状态", data.status],
      ["负责人", data.assignee ?? "未分配"],
      ["优先级", getPriorityLabel(data.priority ?? 0)],
    ]),
    fields([
      ["团队", data.teamName],
      ["项目", data.projectName],
      ["截止", data.dueDate],
    ]),
  ];
  if (data.labels?.length) {
    elements.push(md(`🏷 ${data.labels.map((l) => `\`${l}\``).join(" ")}`));
  }
  const desc = clip(data.description, 400);
  if (desc) elements.push(hr(), md(desc));
  elements.push(hr());

  const buttons: CardElement[] = [
    button({ text: "在 Linear 中打开", type: "primary", url: data.url }),
    button({ text: "分配给我", value: { action: "assign_to_me", ...base } }),
    button({ text: "订阅", value: { action: "subscribe_issue", ...base } }),
    button({ text: "取消订阅", value: { action: "unsubscribe_issue", ...base } }),
  ];
  if (!data.synced && c.chatId && c.messageId) {
    buttons.push(
      button({
        text: "同步此线程",
        value: { action: "upgrade_sync", ...base },
      }),
    );
  }
  elements.push(row(buttons));
  elements.push(
    personPicker("assignee_pick", "指派给…", {
      value: { action: "assign_to", ...base },
    }),
  );
  elements.push(
    form("comment_form", [
      input("comment", "添加评论（将以你的 Linear 账号发布）", { multiline: true, required: true }),
      button({
        text: "评论",
        name: "submit_comment",
        submit: true,
        value: { action: "comment_issue", ...base },
      }),
    ]),
  );
  elements.push(
    note(
      `创建于 ${data.createdAt}${data.creator ? ` · ${data.creator}` : ""}${data.synced ? " · 已同步线程" : ""}`,
    ),
  );

  return card({
    title: `${data.identifier} ${data.title}`,
    template: statusTemplate(data.statusType, data.status),
    elements,
  });
}

/** 链接预览用的精简版（url.preview.get 有 3 秒时限，且没有会话上下文） */
export function buildIssueCompactCard(data: IssueCardData): Record<string, unknown> {
  const base = { issueId: data.identifier };
  const elements: CardElement[] = [
    fields([
      ["状态", data.status],
      ["负责人", data.assignee ?? "未分配"],
      ["优先级", getPriorityLabel(data.priority ?? 0)],
    ]),
  ];
  const desc = clip(data.description, 200);
  if (desc) elements.push(md(desc));
  elements.push(
    row([
      button({ text: "打开", type: "primary", url: data.url }),
      button({ text: "分配给我", value: { action: "assign_to_me", ...base } }),
      button({ text: "订阅", value: { action: "subscribe_issue", ...base } }),
      button({ text: "取消订阅", value: { action: "unsubscribe_issue", ...base } }),
    ]),
    personPicker("assignee_pick", "指派给…", {
      value: { action: "assign_to", ...base },
    }),
  );
  return card({
    title: `${data.identifier} ${data.title}`,
    template: statusTemplate(data.statusType, data.status),
    elements,
  });
}

// ───────────────────────── Project / Document / Initiative ─────────────────────────

export function buildProjectCard(d: {
  name: string;
  description?: string;
  status: string;
  lead?: string;
  targetDate?: string;
  progress?: number;
  url: string;
}): Record<string, unknown> {
  return card({
    title: `📁 ${d.name}`,
    template: "turquoise",
    elements: [
      fields([
        ["状态", d.status],
        ["负责人", d.lead],
        ["目标日期", d.targetDate],
        ["进度", d.progress !== undefined ? `${Math.round(d.progress * 100)}%` : undefined],
      ]),
      ...(d.description ? [md(clip(d.description, 300))] : []),
      row([button({ text: "查看项目", type: "primary", url: d.url })]),
    ],
  });
}

export function buildDocumentCard(d: {
  title: string;
  snippet?: string;
  creator?: string;
  updatedAt?: string;
  url: string;
}): Record<string, unknown> {
  return card({
    title: `📄 ${d.title}`,
    template: "wathet",
    elements: [
      ...(d.snippet ? [md(clip(d.snippet, 300))] : []),
      note([d.creator, d.updatedAt && `更新于 ${d.updatedAt}`].filter(Boolean).join(" · ")),
      row([button({ text: "打开文档", type: "primary", url: d.url })]),
    ],
  });
}

export function buildInitiativeCard(d: {
  name: string;
  description?: string;
  status?: string;
  owner?: string;
  targetDate?: string;
  url: string;
}): Record<string, unknown> {
  return card({
    title: `🎯 ${d.name}`,
    template: "purple",
    elements: [
      fields([
        ["状态", d.status],
        ["负责人", d.owner],
        ["目标日期", d.targetDate],
      ]),
      ...(d.description ? [md(clip(d.description, 300))] : []),
      row([button({ text: "查看 Initiative", type: "primary", url: d.url })]),
    ],
  });
}

/** 包装成 url.preview.get 的回包 */
export function toPreview(title: string, cardJson: Record<string, unknown>) {
  return {
    inline: { i18n_title: { zh_cn: title, en_us: title } },
    card: { type: "raw", data: cardJson },
  };
}

// ───────────────────────── 通知卡片 ─────────────────────────

export function buildIssueNotifyCard(d: {
  identifier?: string;
  title: string;
  status?: string;
  statusType?: string;
  url: string;
  action: string;
  actor: string;
  detail?: string;
  assignee?: string;
  extraButtons?: CardElement[];
}): Record<string, unknown> {
  return card({
    title: `${d.action}${d.identifier ? ` · ${d.identifier}` : ""} ${d.title}`,
    template: statusTemplate(d.statusType, d.status),
    elements: [
      fields([
        ["操作者", d.actor],
        ["状态", d.status],
        ["负责人", d.assignee],
      ]),
      ...(d.detail ? [md(clip(d.detail, 500))] : []),
      row([
        button({ text: "查看详情", type: "primary", url: d.url }),
        ...(d.extraButtons ?? []),
      ]),
    ],
  });
}

// ───────────────────────── 创建 Issue 表单 ─────────────────────────

export interface CreateFormData {
  /** 当前表单对应的团队及其元数据 */
  team: { id: string; name: string };
  teams: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  states: Array<{ id: string; name: string }>;
  labels: Array<{ id: string; name: string }>;
  templates: Array<{ id: string; name: string }>;
  defaults: {
    title?: string;
    description?: string;
    projectId?: string;
    templateId?: string;
  };
  chatId: string;
  /** 被「转为 Issue」的源消息 */
  messageId?: string;
  threadId?: string;
  /** 允许创建后同步线程（需要源消息） */
  allowSync: boolean;
  /** 操作者，仅用于附件来源（斜杠命令里读取最近消息） */
  attachments?: boolean;
}

/** 创建 Issue 表单：团队 / 标题 / 描述 / 项目 / 状态 / 优先级 / 负责人 / 标签 / 模板 / 同步线程 */
export function buildCreateIssueForm(d: CreateFormData): Record<string, unknown> {
  const ctxValue = {
    chatId: d.chatId,
    messageId: d.messageId ?? "",
    threadId: d.threadId ?? "",
    formTeamId: d.team.id,
  };
  const elements: CardElement[] = [];

  if (d.teams.length > 1) {
    elements.push(
      md(`**团队：${d.team.name}**　（切换团队会重置表单中的状态/标签/模板选项）`),
      row(
        d.teams
          .filter((t) => t.id !== d.team.id)
          .slice(0, 6)
          .map((t) =>
            button({
              text: `切换到 ${t.name}`,
              value: {
                action: "create_form_switch_team",
                ...ctxValue,
                teamId: t.id,
                title: d.defaults.title ?? "",
              },
            }),
          ),
      ),
    );
  }

  const formEls: CardElement[] = [
    input("title", "Issue 标题", {
      required: true,
      defaultValue: d.defaults.title?.slice(0, 200),
    }),
    input("description", "描述（可选，支持 Markdown）", {
      multiline: true,
      defaultValue: d.defaults.description,
    }),
  ];
  if (d.projects.length) {
    formEls.push(
      select(
        "projectId",
        "项目（可选）",
        d.projects.map((p) => ({ label: p.name, value: p.id })),
        { initial: d.projects.find((p) => p.id === d.defaults.projectId)?.name },
      ),
    );
  }
  if (d.states.length) {
    formEls.push(
      select(
        "stateId",
        "状态（可选）",
        d.states.map((s) => ({ label: s.name, value: s.id })),
      ),
    );
  }
  formEls.push(
    select("priority", "优先级（可选）", [
      { label: "Urgent", value: "1" },
      { label: "High", value: "2" },
      { label: "Medium", value: "3" },
      { label: "Low", value: "4" },
    ]),
    personPicker("assignee", "负责人（默认：我）"),
  );
  if (d.labels.length) {
    formEls.push(
      select(
        "labelIds",
        "标签（可多选）",
        d.labels.slice(0, 50).map((l) => ({ label: l.name, value: l.id })),
        { multi: true },
      ),
    );
  }
  if (d.templates.length) {
    formEls.push(
      select(
        "templateId",
        "模板（可选）",
        d.templates.slice(0, 10).map((t) => ({ label: t.name, value: t.id })),
        { initial: d.templates.find((t) => t.id === d.defaults.templateId)?.name },
      ),
    );
  }
  formEls.push(
    row([
      button({
        text: "创建 Issue",
        type: "primary",
        name: "submit_create",
        submit: true,
        value: { action: "submit_create_issue", ...ctxValue, sync: false },
      }),
      ...(d.allowSync
        ? [
            button({
              text: "创建并同步线程",
              name: "submit_create_sync",
              submit: true,
              value: { action: "submit_create_issue", ...ctxValue, sync: true },
            }),
          ]
        : []),
    ]),
  );
  elements.push(form("create_issue_form", formEls));

  return card({
    title: "📝 创建 Linear Issue",
    subtitle: d.team.name,
    template: "blue",
    shared: false,
    elements,
  });
}

/** 关联已有 Issue 表单（不建立同步，仅在 Linear 上挂回链） */
export function buildLinkIssueForm(d: {
  chatId: string;
  messageId?: string;
  threadId?: string;
  allowSync: boolean;
}): Record<string, unknown> {
  const v = { chatId: d.chatId, messageId: d.messageId ?? "", threadId: d.threadId ?? "" };
  return card({
    title: "🔗 关联已有 Linear Issue",
    template: "blue",
    shared: false,
    elements: [
      form("link_issue_form", [
        input("issueKey", "输入 Issue 编号或链接，如 ENG-123", { required: true }),
        row([
          button({
            text: "关联",
            type: "primary",
            name: "submit_link",
            submit: true,
            value: { action: "submit_link_issue", ...v, sync: false },
          }),
          ...(d.allowSync
            ? [
                button({
                  text: "关联并同步线程",
                  name: "submit_link_sync",
                  submit: true,
                  value: { action: "submit_link_issue", ...v, sync: true },
                }),
              ]
            : []),
        ]),
      ]),
    ],
  });
}

/** 评论表单（从通知卡片的「评论」按钮打开） */
export function buildCommentForm(d: { issueId: string; title?: string }): Record<string, unknown> {
  return card({
    title: `💬 评论 ${d.issueId}`,
    subtitle: d.title,
    template: "blue",
    elements: [
      form("comment_form", [
        input("comment", "评论内容（将以你的 Linear 账号发布）", { multiline: true, required: true }),
        button({
          text: "发表评论",
          type: "primary",
          name: "submit_comment",
          submit: true,
          value: { action: "comment_issue", issueId: d.issueId, chatId: "", messageId: "", threadId: "", closeAfter: true },
        }),
      ]),
    ],
  });
}

/** 通用结果卡片：用于表单提交后替换表单 */
export function buildResultCard(d: {
  ok: boolean;
  title: string;
  text?: string;
  url?: string;
  buttonText?: string;
}): Record<string, unknown> {
  return card({
    title: d.title,
    template: d.ok ? "green" : "red",
    elements: [
      ...(d.text ? [md(d.text)] : []),
      ...(d.url ? [row([button({ text: d.buttonText ?? "在 Linear 中打开", type: "primary", url: d.url })])] : []),
    ],
  });
}
