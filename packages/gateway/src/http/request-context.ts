import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AppLocale,
  appLocaleSchema,
  RemoteInvocationContext,
} from "@artemis/protocol";
export interface GatewayRequestContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  token: string;
  locale: AppLocale;
  parsedLocale: ReturnType<typeof appLocaleSchema.safeParse>;
  clientInvocation(
    invocation: RemoteInvocationContext,
  ): RemoteInvocationContext;
  identityStillBound(invocation: RemoteInvocationContext): boolean;
}
