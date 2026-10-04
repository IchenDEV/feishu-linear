/**
 * 飞书卡片 JSON 2.0 小工具。
 * 注意 2.0 已不支持 `action` 交互模块、`note` 组件、`div.fields` 和 `multi_url`：
 *  - 按钮直接放在 elements（或 column_set 里）
 *  - 跳转用 behaviors: [{ type: "open_url", default_url }]
 *  - 回传用 behaviors: [{ type: "callback", value }]
 */

export type CardElement = Record<string, unknown>;

export function md(content: string, extra: Record<string, unknown> = {}): CardElement {
  return { tag: "markdown", content, ...extra };
}

/** 小号灰字，代替 1.0 的 note */
export function note(content: string): CardElement {
  return md(content, { text_size: "notation" });
}

export function hr(): CardElement {
  return { tag: "hr" };
}

export function openUrl(url: string) {
  return { type: "open_url", default_url: url, pc_url: url, android_url: url, ios_url: url };
}

export function callback(value: Record<string, unknown>) {
  return { type: "callback", value };
}

export interface ButtonOpts {
  text: string;
  type?: "default" | "primary" | "danger" | "primary_text" | "danger_text";
  url?: string;
  value?: Record<string, unknown>;
  name?: string;
  /** 在 form 内作为提交按钮 */
  submit?: boolean;
  confirm?: { title: string; text: string };
}

export function button(o: ButtonOpts): CardElement {
  const behaviors: unknown[] = [];
  if (o.url) behaviors.push(openUrl(o.url));
  if (o.value) behaviors.push(callback(o.value));
  return {
    tag: "button",
    ...(o.name ? { name: o.name } : {}),
    text: { tag: "plain_text", content: o.text },
    type: o.type ?? "default",
    ...(o.submit ? { form_action_type: "submit" } : {}),
    ...(o.confirm
      ? {
          confirm: {
            title: { tag: "plain_text", content: o.confirm.title },
            text: { tag: "plain_text", content: o.confirm.text },
          },
        }
      : {}),
    behaviors,
  };
}

/** 横向排布一组组件（自动换行），代替 1.0 的 action */
export function row(items: CardElement[]): CardElement {
  return {
    tag: "column_set",
    flex_mode: "flow",
    horizontal_spacing: "8px",
    columns: items.map((el) => ({
      tag: "column",
      width: "auto",
      vertical_align: "center",
      elements: [el],
    })),
  };
}

/** 一行「标签 / 值」字段，代替 1.0 的 div.fields */
export function fields(items: Array<[string, string | undefined | null]>): CardElement {
  const real = items.filter(([, v]) => v !== undefined && v !== null && v !== "");
  return {
    tag: "column_set",
    flex_mode: "bisect",
    columns: real.map(([label, value]) => ({
      tag: "column",
      width: "weighted",
      weight: 1,
      elements: [md(`**${label}**\n${value}`)],
    })),
  };
}

export function input(
  name: string,
  placeholder: string,
  o: { required?: boolean; defaultValue?: string; multiline?: boolean; label?: string } = {},
): CardElement {
  return {
    tag: "input",
    name,
    required: o.required ?? false,
    placeholder: { tag: "plain_text", content: placeholder },
    ...(o.label ? { label: { tag: "plain_text", content: o.label }, label_position: "left" } : {}),
    ...(o.defaultValue ? { default_value: o.defaultValue } : {}),
    ...(o.multiline ? { input_type: "multiline_text", rows: 3, auto_resize: true, max_rows: 8 } : {}),
    width: "fill",
  };
}

export interface SelectOption {
  label: string;
  value: string;
}

export function select(
  name: string,
  placeholder: string,
  options: SelectOption[],
  o: { required?: boolean; initial?: string; multi?: boolean } = {},
): CardElement {
  return {
    tag: o.multi ? "multi_select_static" : "select_static",
    name,
    required: o.required ?? false,
    placeholder: { tag: "plain_text", content: placeholder },
    options: options.map((x) => ({
      text: { tag: "plain_text", content: x.label.slice(0, 60) },
      value: x.value,
    })),
    ...(o.initial && !o.multi ? { initial_option: o.initial } : {}),
    width: "fill",
  };
}

export function personPicker(
  name: string,
  placeholder: string,
  o: { value?: Record<string, unknown>; required?: boolean } = {},
): CardElement {
  return {
    tag: "select_person",
    name,
    required: o.required ?? false,
    placeholder: { tag: "plain_text", content: placeholder },
    options: [],
    ...(o.value ? { behaviors: [callback(o.value)] } : {}),
  };
}

export function form(name: string, elements: CardElement[]): CardElement {
  return { tag: "form", name, elements };
}

export interface CardOpts {
  title: string;
  subtitle?: string;
  template?: string;
  elements: CardElement[];
  /** @deprecated JSON 2.0 恒为共享卡片 */
  shared?: boolean;
}

export function card(o: CardOpts): Record<string, unknown> {
  return {
    schema: "2.0",
    // JSON 2.0 只支持共享卡片（update_multi 只能为 true）
    config: { update_multi: true, width_mode: "fill" },
    header: {
      title: { tag: "plain_text", content: o.title.slice(0, 120) },
      ...(o.subtitle
        ? { subtitle: { tag: "plain_text", content: o.subtitle.slice(0, 120) } }
        : {}),
      template: o.template ?? "blue",
    },
    body: { elements: o.elements },
  };
}

/** 截断 Markdown 描述，避免卡片过长 */
export function clip(text: string | undefined | null, n = 300): string {
  if (!text) return "";
  return text.length > n ? `${text.slice(0, n)}…` : text;
}
