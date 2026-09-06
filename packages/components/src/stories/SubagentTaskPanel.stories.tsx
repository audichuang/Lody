import type { Meta, StoryObj } from '@storybook/react';
import { userEvent, within } from 'storybook/test';
import { SubagentTaskPanel, type SubagentTask } from '@/components/ai-gui/subagent-task-panel';

const running: SubagentTask[] = [
  {
    type: 'subagent_task',
    event: 'task_progress',
    taskId: 'task-1',
    status: 'in_progress',
    subagentType: 'Explore',
    description: 'Find codex capability refresh logic',
    lastToolName: 'Read',
    summary: 'Reading apps/cli/src/agent/acp-capabilities.ts',
  },
  {
    type: 'subagent_task',
    event: 'task_progress',
    taskId: 'task-2',
    status: 'in_progress',
    subagentType: 'Explore',
    description: 'Find CLI version detection and startup path',
    lastToolName: 'Grep',
  },
];

const completed: SubagentTask[] = [
  {
    type: 'subagent_task',
    event: 'task_notification',
    taskId: 'task-1',
    status: 'completed',
    subagentType: 'Explore',
    description: 'Find codex capability refresh logic',
    summary: 'Capabilities refresh runs in acp-capabilities.ts on startup and version change.',
    usage: { totalTokens: 18420, toolUses: 6, durationMs: 42000 },
  },
  {
    type: 'subagent_task',
    event: 'task_notification',
    taskId: 'task-2',
    status: 'completed',
    subagentType: 'Explore',
    description: 'Find CLI version detection and startup path',
    summary: 'Version detected in start.ts via readPackageVersion().',
    usage: { totalTokens: 9200, toolUses: 3 },
  },
];

const mixed: SubagentTask[] = [
  {
    type: 'subagent_task',
    event: 'task_notification',
    taskId: 'task-1',
    status: 'completed',
    subagentType: 'Explore',
    description: 'Find codex capability refresh logic',
    summary: 'Done — see acp-capabilities.ts.',
  },
  {
    type: 'subagent_task',
    event: 'task_updated',
    taskId: 'task-2',
    status: 'failed',
    subagentType: 'general-purpose',
    description: 'Run the flaky integration suite',
    error: 'listen EPERM: operation not permitted 127.0.0.1:0 (sandboxed socket bind)',
  },
  {
    type: 'subagent_task',
    event: 'task_progress',
    taskId: 'task-3',
    status: 'in_progress',
    subagentType: 'Plan',
    description: 'Draft the migration plan',
    isBackgrounded: true,
    lastToolName: 'Write',
  },
  {
    type: 'subagent_task',
    event: 'task_started',
    taskId: 'task-4',
    status: 'pending',
    taskType: 'local_workflow',
    workflowName: 'spec',
    description: 'Generate the spec document',
  },
];

const many: SubagentTask[] = Array.from({ length: 16 }, (_, index) => ({
  type: 'subagent_task',
  event: 'task_notification',
  taskId: `many-task-${index + 1}`,
  status: 'completed',
  subagentType: index % 3 === 0 ? 'Plan' : 'Explore',
  description: `Inspect subsystem ${index + 1}`,
  summary: `Finished subsystem ${index + 1}.`,
  usage: { totalTokens: 4200 + index * 350, toolUses: 2 + (index % 5) },
}));

/** Independently authored synthetic examples of missing and retained progress. */
const workflowBeforeProgress: SubagentTask[] = [
  {
    type: 'subagent_task',
    taskId: 'synthetic-workflow',
    status: 'completed',
    taskKind: 'background',
    actor: 'Task',
    description: 'Review sample modules',
    summary: 'Sample review complete.',
    usage: { totalTokens: 12000, toolUses: 3, durationMs: 24000 },
  },
];
const workflowAfterProgress: SubagentTask[] = [
  {
    ...workflowBeforeProgress[0]!,
    actor: 'module-review',
    lastToolName: 'module-reader',
  },
];

/** Synthetic live agents, including one queued agent and one completed agent. */
const workflowWithAgents: SubagentTask[] = [
  {
    type: 'subagent_task',
    taskId: 'synthetic-group',
    status: 'in_progress',
    taskKind: 'background',
    actor: 'module-review',
    description: 'Inspect sample modules',
    isBackgrounded: true,
    groupProgress: {
      phases: [
        { index: 0, title: 'Inspect' },
        { index: 1, title: 'Summarize' },
      ],
      agents: [
        {
          index: 0,
          label: 'api-reader',
          phaseIndex: 0,
          state: 'completed',
          tokens: 4200,
          durationMs: 12000,
        },
        {
          index: 1,
          label: 'ui-reader',
          phaseIndex: 0,
          state: 'in_progress',
          durationMs: 0,
          startedAtEpochSeconds: Date.now() / 1000 - 10,
        },
        { index: 2, label: 'report-writer', phaseIndex: 1, state: 'pending' },
      ],
    },
  },
];

/**
 * A synthetic narrow case: labels long enough to compete with the
 * preview and the meta column, on a task that has already settled. The agent left in
 * `in_progress` renders as unknown rather than as a spinner, because no trailing tick ever
 * reported how it ended.
 */
const settledWorkflowLongLabels: SubagentTask[] = [
  {
    type: 'subagent_task',
    taskId: 'w-long',
    status: 'completed',
    taskKind: 'background',
    actor: 'audit-workflow',
    description: 'audit the responsive layout',
    isBackgrounded: true,
    summary: 'Dynamic workflow completed',
    groupProgress: {
      phases: [
        { index: 1, title: 'Survey' },
        { index: 2, title: 'Verify' },
      ],
      agents: [
        {
          index: 1,
          label: 'research-codebase-patterns',
          phaseIndex: 1,
          state: 'completed',
          tokens: 128400,
          durationMs: 42310,
          promptPreview: 'Find every dense list in the components package and report its idiom',
        },
        {
          index: 2,
          label: 'verify-protocol-capabilities',
          phaseIndex: 1,
          state: 'failed',
          tokens: 8200,
          durationMs: 3100,
          promptPreview: 'Check the negotiated protocol capabilities against the daemon',
        },
        {
          index: 3,
          label: 'summarize-findings',
          phaseIndex: 2,
          state: 'in_progress',
          promptPreview: 'Fold both surveys into one recommendation',
        },
        { index: 4, label: 'publish-report', phaseIndex: 2, state: 'pending' },
      ],
    },
  } as SubagentTask,
];

const meta = {
  title: 'Sessions/SubagentTaskPanel',
  component: SubagentTaskPanel,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[560px] max-w-full p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SubagentTaskPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = { args: { tasks: running } };
export const Completed: Story = { args: { tasks: completed } };
export const Mixed: Story = { args: { tasks: mixed } };
export const SingleRunning: Story = { args: { tasks: [running[0] as SubagentTask] } };
export const ManyCompleted: Story = { args: { tasks: many } };

/** Progress missing: only the final notification is available. */
export const WorkflowBeforeProgress: Story = { args: { tasks: workflowBeforeProgress } };

/** Progress retained: identity and last tool survive completion. */
export const WorkflowAfterProgress: Story = { args: { tasks: workflowAfterProgress } };

/** The workflow's own agents, grouped by the phase that declared them. */
export const WorkflowWithAgents: Story = { args: { tasks: workflowWithAgents } };

/**
 * Long labels at phone width — the identity column truncates, so no agent row overflows.
 * A settled panel collapses, so the story opens it the way a reader would.
 */
export const WorkflowNarrow: Story = {
  args: { tasks: settledWorkflowLongLabels },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { expanded: false }));
  },
};
