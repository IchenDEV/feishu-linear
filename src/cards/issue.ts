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
import { t } from "../i18n/index.js";

const STATUS_TEMPLATE: Record<string, string> = {
  triage: "yellow",
  backlog: "grey",
  unstarted: "grey",
  started: "blue",
  completed: "green",
  canceled: "red",
};

export function getPriorityLabel(priority: number): string {
  switch (priority) {
    case 0:
      return t("priority.none");
    case 1:
      return t("priority.urgent");
    case 2:
      return t("priority.high");
    case 3:
      return t("priority.medium");
    case 4:
      return t("priority.low");
    default:
      return String(priority);
  }
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
      [t("field.status"), data.status],
      [t("field.assignee"), data.assignee ?? t("field.unassigned")],
      [t("field.priority"), getPriorityLabel(data.priority ?? 0)],
    ]),
    fields([
      [t("field.team"), data.teamName],
      [t("field.project"), data.projectName],
      [t("field.dueDate"), data.dueDate],
    ]),
  ];
  if (data.labels?.length) {
    elements.push(md(`🏷 ${data.labels.map((l) => `\`${l}\``).join(" ")}`));
  }
  const desc = clip(data.description, 400);
  if (desc) elements.push(hr(), md(desc));
  elements.push(hr());

  const buttons: CardElement[] = [
    button({ text: t("btn.openInLinear"), type: "primary", url: data.url }),
    button({ text: t("btn.assignToMe"), value: { action: "assign_to_me", ...base } }),
    button({ text: t("btn.subscribe"), value: { action: "subscribe_issue", ...base } }),
    button({ text: t("btn.unsubscribe"), value: { action: "unsubscribe_issue", ...base } }),
  ];
  if (!data.synced && c.chatId && c.messageId) {
    buttons.push(
      button({
        text: t("btn.syncThread"),
        value: { action: "upgrade_sync", ...base },
      }),
    );
  }
  elements.push(row(buttons));
  elements.push(
    personPicker("assignee_pick", t("card.issue.assignPlaceholder"), {
      value: { action: "assign_to", ...base },
    }),
  );
  elements.push(
    form("comment_form", [
      input("comment", t("card.issue.commentPlaceholder"), { multiline: true, required: true }),
      button({
        text: t("btn.comment"),
        name: "submit_comment",
        submit: true,
        value: { action: "comment_issue", ...base },
      }),
    ]),
  );
  elements.push(
    note(
      `${t("card.issue.createdAt", { date: data.createdAt })}${data.creator ? ` · ${data.creator}` : ""}${data.synced ? ` · ${t("card.issue.threadSynced")}` : ""}`,
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
      [t("field.status"), data.status],
      [t("field.assignee"), data.assignee ?? t("field.unassigned")],
      [t("field.priority"), getPriorityLabel(data.priority ?? 0)],
    ]),
  ];
  const desc = clip(data.description, 200);
  if (desc) elements.push(md(desc));
  elements.push(
    row([
      button({ text: t("btn.open"), type: "primary", url: data.url }),
      button({ text: t("btn.assignToMe"), value: { action: "assign_to_me", ...base } }),
      button({ text: t("btn.subscribe"), value: { action: "subscribe_issue", ...base } }),
      button({ text: t("btn.unsubscribe"), value: { action: "unsubscribe_issue", ...base } }),
    ]),
    personPicker("assignee_pick", t("card.issue.assignPlaceholder"), {
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
        [t("field.status"), d.status],
        [t("field.lead"), d.lead],
        [t("field.targetDate"), d.targetDate],
        [t("field.progress"), d.progress !== undefined ? `${Math.round(d.progress * 100)}%` : undefined],
      ]),
      ...(d.description ? [md(clip(d.description, 300))] : []),
      row([button({ text: t("btn.viewProject"), type: "primary", url: d.url })]),
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
      note([d.creator, d.updatedAt && t("card.document.updatedAt", { date: d.updatedAt })].filter(Boolean).join(" · ")),
      row([button({ text: t("btn.openDocument"), type: "primary", url: d.url })]),
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
        [t("field.status"), d.status],
        [t("field.owner"), d.owner],
        [t("field.targetDate"), d.targetDate],
      ]),
      ...(d.description ? [md(clip(d.description, 300))] : []),
      row([button({ text: t("btn.viewInitiative"), type: "primary", url: d.url })]),
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
        [t("field.actor"), d.actor],
        [t("field.status"), d.status],
        [t("field.assignee"), d.assignee],
      ]),
      ...(d.detail ? [md(clip(d.detail, 500))] : []),
      row([
        button({ text: t("btn.viewDetails"), type: "primary", url: d.url }),
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
      md(t("card.create.team", { team: d.team.name })),
      row(
        d.teams
          .filter((tm) => tm.id !== d.team.id)
          .slice(0, 6)
          .map((tm) =>
            button({
              text: t("card.create.switchTeam", { team: tm.name }),
              value: {
                action: "create_form_switch_team",
                ...ctxValue,
                teamId: tm.id,
                title: d.defaults.title ?? "",
              },
            }),
          ),
      ),
    );
  }

  const formEls: CardElement[] = [
    input("title", t("card.create.titleInput"), {
      required: true,
      defaultValue: d.defaults.title?.slice(0, 200),
    }),
    input("description", t("card.create.descInput"), {
      multiline: true,
      defaultValue: d.defaults.description,
    }),
  ];
  if (d.projects.length) {
    formEls.push(
      select(
        "projectId",
        t("card.create.project"),
        d.projects.map((p) => ({ label: p.name, value: p.id })),
        { initial: d.projects.find((p) => p.id === d.defaults.projectId)?.name },
      ),
    );
  }
  if (d.states.length) {
    formEls.push(
      select(
        "stateId",
        t("card.create.state"),
        d.states.map((s) => ({ label: s.name, value: s.id })),
      ),
    );
  }
  formEls.push(
    select("priority", t("card.create.priority"), [
      { label: t("priority.urgent.plain"), value: "1" },
      { label: t("priority.high.plain"), value: "2" },
      { label: t("priority.medium.plain"), value: "3" },
      { label: t("priority.low.plain"), value: "4" },
    ]),
    personPicker("assignee", t("card.create.assignee")),
  );
  if (d.labels.length) {
    formEls.push(
      select(
        "labelIds",
        t("card.create.labels"),
        d.labels.slice(0, 50).map((l) => ({ label: l.name, value: l.id })),
        { multi: true },
      ),
    );
  }
  if (d.templates.length) {
    formEls.push(
      select(
        "templateId",
        t("card.create.template"),
        d.templates.slice(0, 10).map((tp) => ({ label: tp.name, value: tp.id })),
        { initial: d.templates.find((tp) => tp.id === d.defaults.templateId)?.name },
      ),
    );
  }
  formEls.push(
    row([
      button({
        text: t("card.create.submit"),
        type: "primary",
        name: "submit_create",
        submit: true,
        value: { action: "submit_create_issue", ...ctxValue, sync: false },
      }),
      ...(d.allowSync
        ? [
            button({
              text: t("card.create.submitSync"),
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
    title: t("card.create.title"),
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
    title: t("card.link.title"),
    template: "blue",
    shared: false,
    elements: [
      form("link_issue_form", [
        input("issueKey", t("card.link.input"), { required: true }),
        row([
          button({
            text: t("card.link.submit"),
            type: "primary",
            name: "submit_link",
            submit: true,
            value: { action: "submit_link_issue", ...v, sync: false },
          }),
          ...(d.allowSync
            ? [
                button({
                  text: t("card.link.submitSync"),
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
    title: t("card.comment.title", { issue: d.issueId }),
    subtitle: d.title,
    template: "blue",
    elements: [
      form("comment_form", [
        input("comment", t("card.comment.input"), { multiline: true, required: true }),
        button({
          text: t("btn.postComment"),
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
      ...(d.url ? [row([button({ text: d.buttonText ?? t("btn.openInLinear"), type: "primary", url: d.url })])] : []),
    ],
  });
}
