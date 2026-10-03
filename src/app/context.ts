import type { Client as LarkClient } from "@larksuiteoapi/node-sdk";
import type { LinearClient } from "@linear/sdk";
import type { Env } from "../config.js";
import type { Db } from "../db/index.js";

export interface AppContext {
  config: Env;
  db: Db;
  lark: LarkClient;
  /** 当前可用的 Linear client（api_key 或已刷新的 OAuth token） */
  getLinear: () => Promise<LinearClient>;
  /** Linear App User ID（用于过滤自身 webhook） */
  getLinearAppUserId: () => Promise<string | undefined>;
}
