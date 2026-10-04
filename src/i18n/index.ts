import { AsyncLocalStorage } from "node:async_hooks";
import { messages, type MessageKey } from "./messages/index.js";

export type { MessageKey };

/** 支持的界面语言 */
export const LOCALES = ["zh-CN", "en"] as const;
export type Locale = (typeof LOCALES)[number];

const storage = new AsyncLocalStorage<Locale>();
let defaultLocale: Locale = "zh-CN";

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/** 宽松解析：zh / zh_cn / zh-Hans → zh-CN，en / en_US → en */
export function normalizeLocale(v: unknown): Locale | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase().replace(/_/g, "-");
  if (!s) return undefined;
  if (s.startsWith("zh")) return "zh-CN";
  if (s.startsWith("en")) return "en";
  return undefined;
}

export function setDefaultLocale(locale: Locale) {
  defaultLocale = locale;
}

export function getDefaultLocale(): Locale {
  return defaultLocale;
}

export function currentLocale(): Locale {
  return storage.getStore() ?? defaultLocale;
}

/** 在指定语言下执行（异步调用链内的 t() 都使用该语言） */
export function withLocale<T>(locale: Locale, fn: () => T): T {
  return storage.run(locale, fn);
}

/** 当前上下文语言设为 locale（用于请求入口：解析出语言后，其后的异步调用都继承） */
export function enterLocale(locale: Locale) {
  storage.enterWith(locale);
}

/** 翻译：`{name}` 形式的占位符按 params 替换 */
export function t(
  key: MessageKey,
  params?: Record<string, string | number | undefined | null>,
): string {
  return translate(currentLocale(), key, params);
}

export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number | undefined | null>,
): string {
  const entry = messages[key];
  const template = entry?.[locale] ?? entry?.["zh-CN"] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name];
    return v === undefined || v === null ? "" : String(v);
  });
}

/** 飞书 i18n 字段（卡片标题、链接预览等需要同时提供多种语言） */
export function i18nPair(key: MessageKey, params?: Record<string, string | number | undefined | null>) {
  return {
    zh_cn: translate("zh-CN", key, params),
    en_us: translate("en", key, params),
  };
}

/** 延迟求值的文案：事件发生时还不知道接收方语言，发送给每个接收方时再在其语言下求值 */
export type LazyText = string | (() => string);
export function lazy(v: LazyText | undefined): string | undefined {
  return typeof v === "function" ? v() : v;
}
