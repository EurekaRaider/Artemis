import type { AgentRuntimeConfiguration } from "@artemis/protocol";
import type {
  AgentBroker,
  AgentHostSink,
  HostedThread,
} from "../runtime-types.js";

// Tools observe current session state and broker operations through the one
// existing Pi loop. The live configuration getter survives runtime reconfigure.
export interface BrokerToolContext {
  readonly threads: ReadonlyMap<string, HostedThread>;
  readonly broker: AgentBroker;
  readonly sink: AgentHostSink;
  readonly configuration: AgentRuntimeConfiguration;
  serializeUserInput<T>(threadId: string, action: () => Promise<T>): Promise<T>;
}
