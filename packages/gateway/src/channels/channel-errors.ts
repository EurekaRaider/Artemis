export class ChannelRateLimit extends Error {
  constructor(readonly seconds: number) {
    super("Channel rate limit reached.");
  }
}

export class ChannelUnavailable extends Error {}

export class DeliveryUncertain extends Error {}
