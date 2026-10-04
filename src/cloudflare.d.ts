// Cloudflare Workers 运行时提供的模块（仅类型声明，避免引入完整 workers-types 与 @types/node 冲突）
declare module "cloudflare:workers" {
  export const env: Record<string, any>;
  export function waitUntil(promise: Promise<unknown>): void;
}

declare module "cloudflare:node" {
  export function httpServerHandler(options: { port: number }): {
    fetch(request: Request, env?: unknown, ctx?: unknown): Promise<Response>;
  };
}
