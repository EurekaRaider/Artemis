import { userInfo } from "node:os";

import { applicationHost } from "../application/application-host.js";

/** The name used when none is saved; verification hosts may substitute one. */
export function defaultUserName(): string {
  return applicationHost.userName ?? userInfo().username;
}
