export function agentRoleSegment(agentRole: string | null | undefined): string {
  return (agentRole ?? '').split('-').pop() ?? '';
}

export function agentRoleBgColor(segment: string): string {
  switch (segment) {
    case 'dev':
      return 'bg-blue-500';
    case 'research':
      return 'bg-purple-500';
    case 'review':
      return 'bg-green-500';
    case 'refine':
      return 'bg-orange-500';
    default:
      return 'bg-primary';
  }
}
