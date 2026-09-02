import type { DeliveryChannel } from "./types";

export const DELIVERY_CHANNELS: DeliveryChannel[] = ["alpha", "test", "production"];

export function isDeliveryChannel(value: string): value is DeliveryChannel {
  return DELIVERY_CHANNELS.includes(value as DeliveryChannel);
}
