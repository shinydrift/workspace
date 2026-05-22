export type TemplateKey = 'wiki_update' | 'standup' | 'custom';

export interface NodeTemplate {
  name: string;
  instructions: string;
}

export const NODE_TEMPLATES: Record<TemplateKey, NodeTemplate> = {
  wiki_update: {
    name: 'Update Wiki',
    instructions: `Review recent thread activity and the execution log context from previous nodes.
Create or update wiki pages documenting: architecture decisions, key patterns discovered,
solutions found, and anything reusable for future reference.
Use the wiki write tool to save each page.
Call agentos_run_set_node_status with your nodeId and a summary of what you documented.`,
  },
  standup: {
    name: 'Standup Report',
    instructions: `Generate a concise standup report based on recent thread activity and execution log context.
Include: what was accomplished, what is in progress, any blockers or open questions.
Call agentos_run_set_node_status with your nodeId and the standup report as the output.`,
  },
  custom: {
    name: 'Custom',
    instructions: '',
  },
};
