import * as lark from "@larksuiteoapi/node-sdk";

/**
 * 飞书 SDK 底层是 axios。Workers 里 axios 会选 fetch 适配器，
 * 但它构造 Request 时带上 `cache: 'default'` 等浏览器选项，workerd 会抛
 * "Unsupported cache mode: default"。这里让默认实例改用 fetch 适配器，
 * 并换一个剔除这些选项的 Request 实现。
 */
const UNSUPPORTED = [
  "cache",
  "referrer",
  "referrerPolicy",
  "mode",
  "integrity",
  "keepalive",
  "priority",
  "window",
] as const;

class WorkersRequest extends Request {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    if (init) {
      const clean = { ...init } as Record<string, unknown>;
      for (const key of UNSUPPORTED) delete clean[key];
      super(input, clean as RequestInit);
    } else {
      super(input);
    }
  }
}

export function patchLarkHttpForWorkers() {
  const defaults = lark.defaultHttpInstance.defaults as unknown as Record<
    string,
    unknown
  >;
  defaults.adapter = "fetch";
  defaults.env = {
    fetch: globalThis.fetch.bind(globalThis),
    Request: WorkersRequest,
    Response: globalThis.Response,
  };
}
