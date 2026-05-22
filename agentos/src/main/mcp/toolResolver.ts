import { SLACK_EXTERNAL_TOOLS } from '../integrations/slackMcpServer';

/** Tools that send messages externally — flag any session turn that chains a read tool into one of these. */
export const DANGEROUS_TOOLS = new Set<string>(SLACK_EXTERNAL_TOOLS);

/** All tasks have unrestricted tool access — returns an empty disallow list. */
export function resolveDisallowedTools(): string[] {
  return [];
}
