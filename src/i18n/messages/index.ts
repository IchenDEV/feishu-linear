import { cards } from "./cards.js";
import { common } from "./common.js";
import { commands } from "./commands.js";
import { notify } from "./notify.js";
import { sync } from "./sync.js";
import { agent } from "./agent.js";
import { settings } from "./settings.js";
import type { Message } from "./types.js";

export const messages = {
  ...common,
  ...cards,
  ...settings,
  ...commands,
  ...notify,
  ...sync,
  ...agent,
} satisfies Record<string, Message>;

export type MessageKey = keyof typeof messages;
