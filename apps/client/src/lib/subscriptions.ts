import { SubscriptionRequest } from "@mqtt-rover/protocol";

interface SubscriptionProfile {
  subscriptionFilter?: string;
  initialSubscriptions?: SubscriptionRequest[];
}

export function resolveInitialSubscriptions(
  profile: SubscriptionProfile | null | undefined
): SubscriptionRequest[] {
  const configured =
    profile?.initialSubscriptions?.filter(
      (entry) => entry.topicFilter.trim().length > 0
    ) ?? [];

  if (configured.length > 0) {
    return configured;
  }

  return [{ topicFilter: profile?.subscriptionFilter?.trim() || "#", qos: 0 }];
}

export function normalizeInitialSubscriptions(
  next: SubscriptionRequest[]
): SubscriptionRequest[] {
  const normalized = next
    .map((entry) => ({
      ...entry,
      topicFilter: entry.topicFilter.trim()
    }))
    .filter((entry) => entry.topicFilter.length > 0);

  return normalized.length > 0
    ? normalized
    : [{ topicFilter: "#", qos: 0 as 0 | 1 | 2 }];
}
