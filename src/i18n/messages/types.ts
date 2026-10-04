/** 一条文案：每种界面语言都必须提供（缺一个就无法通过类型检查） */
export interface Message {
  "zh-CN": string;
  en: string;
}
export type Catalog = Record<string, Message>;
