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
import { LOCALES, t, type Locale } from "../i18n/index.js";

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
  /** 本群显式设置的语言（空 = 跟随工作区）与工作区默认语言 */
  locale?: { chat?: Locale; workspace: Locale };
  workspace?: {
    /** 当前操作者是 Linear 管理员才显示 */
    guidance?: string;
    autoProjectChannels: boolean;
    privateProjectChannels: boolean;
  };
}

function typeLabel(type: string): string {
  switch (type) {
    case "team":
      return t("settings.subs.kind.team");
    case "project":
      return t("settings.subs.kind.project");
    case "initiative":
      return t("settings.subs.kind.initiative");
    case "view":
      return t("settings.subs.kind.view");
    default:
      return type;
  }
}

function localeLabel(l: Locale): string {
  return l === "en" ? t("locale.en") : t("locale.zh-CN");
}

/** 管理员配置卡片（对标 Slack 里 Linear 集成的 channel / workspace 设置） */
export function buildSettingsCard(d: SettingsData): Record<string, unknown> {
  const v = { chatId: d.chatId };
  const el: CardElement[] = [];

  el.push(md(t("settings.defaults.heading")));
  el.push(
    form("defaults_form", [
      select(
        "teamId",
        t("settings.defaults.team"),
        d.teams.map((t) => ({ label: t.name, value: t.id })),
        { initial: d.teams.find((t) => t.id === d.defaults.teamId)?.name },
      ),
      select(
        "projectId",
        t("settings.defaults.project"),
        d.projects.map((p) => ({ label: p.name, value: p.id })),
        { initial: d.projects.find((p) => p.id === d.defaults.projectId)?.name },
      ),
      ...(d.templates.length
        ? [
            select(
              "templateId",
              t("settings.defaults.template"),
              d.templates.map((t) => ({ label: t.name, value: t.id })),
              { initial: d.templates.find((t) => t.id === d.defaults.templateId)?.name },
            ),
          ]
        : []),
      row([
        button({
          text: t("settings.defaults.save"),
          type: "primary",
          name: "save_defaults",
          submit: true,
          value: { action: "save_chat_defaults", ...v },
        }),
        button({
          text: t("settings.defaults.clear"),
          name: "clear_defaults",
          value: { action: "clear_chat_defaults", ...v },
        }),
      ]),
    ]),
  );

  el.push(hr(), md(t("settings.guidance.heading")));
  el.push(
    form("guidance_form", [
      input("guidance", t("settings.guidance.placeholder"), {
        multiline: true,
        defaultValue: d.guidance,
      }),
      row([
        button({
          text: t("settings.guidance.saveChat"),
          type: "primary",
          name: "save_chat_guidance",
          submit: true,
          value: { action: "save_guidance", scope: "chat", ...v },
        }),
        ...(d.workspace
          ? [
              button({
                text: t("settings.guidance.saveWorkspace"),
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
    el.push(note(t("settings.guidance.current", { text: d.workspace.guidance.slice(0, 200) })));
  }

  el.push(hr(), md(t("settings.subs.heading")));
  if (d.subscriptions.length) {
    for (const s of d.subscriptions) {
      el.push(
        row([
          md(`${typeLabel(s.type)}　**${s.name}**　${s.triggers}`),
          button({
            text: t("settings.subs.remove"),
            type: "danger_text",
            value: { action: "remove_sub", kind: s.kind, id: s.id, ...v },
          }),
        ]),
      );
    }
  } else {
    el.push(note(t("settings.subs.empty")));
  }
  el.push(
    form("add_sub_form", [
      select("subType", t("settings.subs.type"), [
        { label: t("settings.subs.type.team"), value: "team" },
        { label: t("settings.subs.type.project"), value: "project" },
        { label: t("settings.subs.type.initiative"), value: "initiative" },
        { label: t("settings.subs.type.view"), value: "view" },
      ], { required: true }),
      input("subName", t("settings.subs.name"), { required: true }),
      select(
        "triggers",
        t("settings.subs.triggers"),
        [
          { label: t("settings.subs.trigger.created"), value: "created" },
          { label: t("settings.subs.trigger.updated"), value: "updated" },
          { label: t("settings.subs.trigger.completed"), value: "completed" },
          { label: t("settings.subs.trigger.comment"), value: "comment" },
        ],
        { multi: true },
      ),
      button({
        text: t("settings.subs.add"),
        type: "primary",
        name: "add_sub",
        submit: true,
        value: { action: "add_sub", ...v },
      }),
    ]),
  );

  el.push(hr(), md(t("settings.asks.heading")));
  el.push(
    d.asks
      ? row([
          md(t("settings.asks.enabled", { team: d.asks.teamName })),
          button({
            text: t("settings.asks.disable"),
            type: "danger_text",
            value: { action: "disable_asks", ...v },
          }),
        ])
      : form("asks_form", [
          select(
            "teamId",
            t("settings.asks.team"),
            d.teams.map((t) => ({ label: t.name, value: t.id })),
            { required: true },
          ),
          button({
            text: t("settings.asks.enable"),
            name: "enable_asks",
            submit: true,
            value: { action: "enable_asks", ...v },
          }),
        ]),
  );

  if (d.workspace) {
    el.push(hr(), md(t("settings.workspace.heading")));
    el.push(
      row([
        button({
          text: t("settings.workspace.autoChannels", { state: d.workspace.autoProjectChannels ? t("settings.on") : t("settings.off") }),
          type: d.workspace.autoProjectChannels ? "primary" : "default",
          value: { action: "toggle_auto_channels", ...v },
        }),
        button({
          text: t("settings.workspace.privateChannels", { state: d.workspace.privateProjectChannels ? t("settings.yes") : t("settings.no") }),
          type: d.workspace.privateProjectChannels ? "primary" : "default",
          value: { action: "toggle_private_channels", ...v },
        }),
      ]),
    );
  }

  if (d.locale) {
    const cur = d.locale.chat ? localeLabel(d.locale.chat) : t("settings.language.auto");
    el.push(hr(), md(t("settings.language.heading")));
    el.push(note(t("settings.language.chat", { current: cur }) + (d.workspace ? ` · ${t("settings.language.workspace", { lang: localeLabel(d.locale.workspace) })}` : "")));
    el.push(
      row([
        ...LOCALES.map((l) =>
          button({
            text: localeLabel(l),
            type: d.locale?.chat === l ? "primary" : "default",
            value: { action: "set_chat_locale", locale: l, ...v },
          }),
        ),
        button({
          text: t("settings.language.auto"),
          type: !d.locale.chat ? "primary" : "default",
          value: { action: "set_chat_locale", locale: "", ...v },
        }),
      ]),
    );
    if (d.workspace) {
      el.push(
        row(
          LOCALES.map((l) =>
            button({
              text: `${t("settings.language.workspace", { lang: localeLabel(l) })}`,
              type: d.locale?.workspace === l ? "primary" : "default",
              value: { action: "set_workspace_locale", locale: l, ...v },
            }),
          ),
        ),
      );
    }
  }

  return card({
    title: t("settings.title"),
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
  locale?: string | null;
}): Record<string, unknown> {
  const toggle = (key: string, label: string, on: boolean) =>
    button({
      text: `${on ? "✅" : "⬜"} ${label}`,
      type: on ? "primary" : "default",
      value: { action: "toggle_pref", key },
    });
  return card({
    title: t("prefs.title"),
    template: "wathet",
    elements: [
      md(t("prefs.intro")),
      row([toggle("enabled", t("prefs.master"), p.enabled)]),
      row([
        toggle("onAssigned", t("prefs.assigned"), p.onAssigned),
        toggle("onMentioned", t("prefs.mentioned"), p.onMentioned),
        toggle("onComment", t("prefs.comment"), p.onComment),
        toggle("onStatusChange", t("prefs.status"), p.onStatusChange),
      ]),
      md(t("prefs.language")),
      row(
        LOCALES.map((l) =>
          button({
            text: localeLabel(l),
            type: p.locale === l ? "primary" : "default",
            value: { action: "set_user_locale", locale: l },
          }),
        ),
      ),
    ],
  });
}
