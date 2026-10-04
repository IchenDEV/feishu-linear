import {
  button,
  card,
  form,
  hr,
  input,
  md,
  note,
  row,
  select,
  type CardElement,
} from "./kit.js";

export interface SettingsData {
  chatId: string;
  chatName?: string;
  teams: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  templates: Array<{ id: string; name: string }>;
  defaults: { teamId?: string; projectId?: string; templateId?: string };
  guidance?: string;
  subscriptions: Array<{
    kind: "config" | "view";
    id: number;
    type: string;
    name: string;
    triggers: string;
  }>;
  asks?: { teamId: string; teamName: string };
  workspace?: {
    /** 当前操作者是 Linear 管理员才显示 */
    guidance?: string;
    autoProjectChannels: boolean;
    privateProjectChannels: boolean;
  };
}

const TYPE_LABEL: Record<string, string> = {
  team: "团队",
  project: "项目",
  initiative: "Initiative",
  view: "视图",
};

/** 管理员配置卡片（对标 Slack 里 Linear 集成的 channel / workspace 设置） */
export function buildSettingsCard(d: SettingsData): Record<string, unknown> {
  const v = { chatId: d.chatId };
  const el: CardElement[] = [];

  el.push(md("**① 本群默认值**（建 Issue / 智能体推断项目时使用）"));
  el.push(
    form("defaults_form", [
      select(
        "teamId",
        "默认团队",
        d.teams.map((t) => ({ label: t.name, value: t.id })),
        { initial: d.teams.find((t) => t.id === d.defaults.teamId)?.name },
      ),
      select(
        "projectId",
        "默认项目",
        d.projects.map((p) => ({ label: p.name, value: p.id })),
        { initial: d.projects.find((p) => p.id === d.defaults.projectId)?.name },
      ),
      ...(d.templates.length
        ? [
            select(
              "templateId",
              "默认模板（属于默认团队）",
              d.templates.map((t) => ({ label: t.name, value: t.id })),
              { initial: d.templates.find((t) => t.id === d.defaults.templateId)?.name },
            ),
          ]
        : []),
      row([
        button({
          text: "保存默认值",
          type: "primary",
          name: "save_defaults",
          submit: true,
          value: { action: "save_chat_defaults", ...v },
        }),
        button({
          text: "清除",
          name: "clear_defaults",
          value: { action: "clear_chat_defaults", ...v },
        }),
      ]),
    ]),
  );

  el.push(hr(), md("**② 智能体指引（Guidance）**"));
  el.push(
    form("guidance_form", [
      input("guidance", "对本群智能体的补充要求，例如：Bug 一律放进 Triage、优先级默认 Medium…", {
        multiline: true,
        defaultValue: d.guidance,
      }),
      row([
        button({
          text: "保存本群指引",
          type: "primary",
          name: "save_chat_guidance",
          submit: true,
          value: { action: "save_guidance", scope: "chat", ...v },
        }),
        ...(d.workspace
          ? [
              button({
                text: "保存为工作区指引",
                name: "save_ws_guidance",
                submit: true,
                value: { action: "save_guidance", scope: "workspace", ...v },
              }),
            ]
          : []),
      ]),
    ]),
  );
  if (d.workspace?.guidance) {
    el.push(note(`当前工作区指引：${d.workspace.guidance.slice(0, 200)}`));
  }

  el.push(hr(), md("**③ 本群订阅的 Linear 通知**"));
  if (d.subscriptions.length) {
    for (const s of d.subscriptions) {
      el.push(
        row([
          md(`${TYPE_LABEL[s.type] ?? s.type}　**${s.name}**　${s.triggers}`),
          button({
            text: "移除",
            type: "danger_text",
            value: { action: "remove_sub", kind: s.kind, id: s.id, ...v },
          }),
        ]),
      );
    }
  } else {
    el.push(note("还没有订阅。下面添加一个。"));
  }
  el.push(
    form("add_sub_form", [
      select("subType", "订阅类型", [
        { label: "团队（填团队名或 key）", value: "team" },
        { label: "项目", value: "project" },
        { label: "Initiative", value: "initiative" },
        { label: "视图（自定义 View）", value: "view" },
      ], { required: true }),
      input("subName", "名称，如 Engineering / 官网改版 / 我的紧急 Bug", { required: true }),
      select(
        "triggers",
        "触发事件（视图：选 新进入/完成/二者）",
        [
          { label: "新建 Issue / 新进入视图", value: "created" },
          { label: "状态等更新", value: "updated" },
          { label: "完成或取消", value: "completed" },
          { label: "新评论", value: "comment" },
        ],
        { multi: true },
      ),
      button({
        text: "添加订阅",
        type: "primary",
        name: "add_sub",
        submit: true,
        value: { action: "add_sub", ...v },
      }),
    ]),
  );

  el.push(hr(), md("**④ Asks：让不在 Linear 的同事也能提需求**"));
  el.push(
    d.asks
      ? row([
          md(`已启用：在本群发送 \`/ask 内容\`，会在团队「${d.asks.teamName}」创建 Issue 并同步进展。`),
          button({
            text: "停用",
            type: "danger_text",
            value: { action: "disable_asks", ...v },
          }),
        ])
      : form("asks_form", [
          select(
            "teamId",
            "接收需求的团队",
            d.teams.map((t) => ({ label: t.name, value: t.id })),
            { required: true },
          ),
          button({
            text: "启用 Asks",
            name: "enable_asks",
            submit: true,
            value: { action: "enable_asks", ...v },
          }),
        ]),
  );

  if (d.workspace) {
    el.push(hr(), md("**⑤ 工作区设置（仅 Linear 管理员）**"));
    el.push(
      row([
        button({
          text: `新项目自动建群：${d.workspace.autoProjectChannels ? "开" : "关"}`,
          type: d.workspace.autoProjectChannels ? "primary" : "default",
          value: { action: "toggle_auto_channels", ...v },
        }),
        button({
          text: `项目群为私有群：${d.workspace.privateProjectChannels ? "是" : "否"}`,
          type: d.workspace.privateProjectChannels ? "primary" : "default",
          value: { action: "toggle_private_channels", ...v },
        }),
      ]),
    );
  }

  return card({
    title: "⚙️ Linear 连接器设置",
    subtitle: d.chatName,
    template: "indigo",
    elements: el,
  });
}

/** 个人通知偏好卡片 */
export function buildPersonalPrefsCard(p: {
  enabled: boolean;
  onAssigned: boolean;
  onMentioned: boolean;
  onComment: boolean;
  onStatusChange: boolean;
}): Record<string, unknown> {
  const toggle = (key: string, label: string, on: boolean) =>
    button({
      text: `${on ? "✅" : "⬜"} ${label}`,
      type: on ? "primary" : "default",
      value: { action: "toggle_pref", key },
    });
  return card({
    title: "🔔 我的 Linear 通知",
    template: "wathet",
    elements: [
      md("机器人会把与你相关的 Linear 动态私聊推给你。点击切换："),
      row([toggle("enabled", "总开关", p.enabled)]),
      row([
        toggle("onAssigned", "分配给我", p.onAssigned),
        toggle("onMentioned", "@ 提及我", p.onMentioned),
        toggle("onComment", "我关注的 Issue 有评论", p.onComment),
        toggle("onStatusChange", "状态变更", p.onStatusChange),
      ]),
    ],
  });
}
