export const extractUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url || '';
};

export interface TestRule {
  id?: number | string;
  rule_type: string;
  trigger_attribute: string;
  trigger_value: string;
  target_attribute: string;
  target_value: string;
  context_attribute?: string | null;
  context_value?: string | null;
  created_at?: string;
  [key: string]: unknown;
}

export const createRulePayload = (
  rule_type: string,
  trigger_attribute: string,
  target_attribute: string,
  trigger_value: string,
  target_value: string,
  extra: Record<string, unknown> = {}
) => ({
  rule_type,
  trigger_attribute,
  target_attribute,
  trigger_value,
  target_value,
  ...extra,
});

export const createRule = (
  id: number | string | null | undefined,
  rule_type: string,
  trigger_attribute: string,
  target_attribute: string,
  trigger_value: string,
  target_value: string,
  extra: Record<string, unknown> = {}
): TestRule => {
  const rule: TestRule = {
    rule_type,
    trigger_attribute,
    target_attribute,
    trigger_value,
    target_value,
    context_attribute: null,
    context_value: null,
    ...extra,
  };
  if (id !== null && id !== undefined) {
    rule.id = id;
  }
  return rule;
};
