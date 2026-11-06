import { type ChannelEvent } from "@artemis/protocol";
import {
  type ChannelAdapter,
  type ChannelConnection,
} from "../channels/channels.js";

export interface GatewayOptions {
  databasePath: string;
  encryptionKey: string;
  adminToken: string;
  adapterFactory?: (
    config: ChannelConnection,
    receive: (event: ChannelEvent) => void,
  ) => ChannelAdapter;
}
