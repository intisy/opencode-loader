// @ts-nocheck
// OpenCode-side adapter: register core-auth's generic Provider tab into the
// shared TUI. All provider/account logic lives in core-auth.

import { registerProviderTab } from "../core-auth/dist/index.js";

export default function (tuiApi) {
  registerProviderTab(tuiApi);
}
