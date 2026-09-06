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


/**
 * A real workflow run, captured from the bundled Claude adapter driven over ACP
 * (Claude Code 2.1.258) and pushed through the CLI's real history pipeline. The two
 * stories below are the SAME run, differing only in whether the history filter keeps
 * non-terminal task lifecycle snapshots.
 */
const realWorkflowBeforeFix: SubagentTask[] = [
  {
    'taskId': 'w5ftatomx',
    'status': 'completed',
    'taskKind': 'background',
    'actor': 'Claude task',
    'toolUseId': 'toolu_01VGYjhBXHoAAc9a8dBx3Upu',
    'description': 'verify task lifecycle reaches history',
    'isBackgrounded': true,
    'summary': 'Dynamic workflow \'verify task lifecycle reaches history\' completed',
    'usage': {
        'totalTokens': 26781,
        'toolUses': 0,
        'durationMs': 1738
    }
} as SubagentTask,
];

const realWorkflowAfterFix: SubagentTask[] = [
  {
    'taskId': 'w5ftatomx',
    'status': 'completed',
    'taskKind': 'background',
    'actor': 'e2e-probe',
    'toolUseId': 'toolu_01VGYjhBXHoAAc9a8dBx3Upu',
    'description': 'Check: checker',
    'isBackgrounded': true,
    'summary': 'Dynamic workflow \'verify task lifecycle reaches history\' completed',
    'lastToolName': 'checker',
    'usage': {
        'totalTokens': 26781,
        'toolUses': 0,
        'durationMs': 1738
    }
} as SubagentTask,
];


/**
 * A workflow run with its own structure. `groupProgress` here is the verbatim result of
 * pushing one captured `_claude/sdkMessage` through the CLI converter and the history
 * applier — the phases, labels and token counts are the run's own; the states are the
 * converter's normalization of the provider's own `done`/`start` words.
 */
const workflowWithAgents: SubagentTask[] = [
  {
    type: 'subagent_task',
    taskId: 'w8sgyv66b',
    status: 'in_progress',
    taskKind: 'background',
    actor: 'raw-probe',
    description: 'Scan: one',
    lastToolName: 'one',
    isBackgrounded: true,
    groupProgress: {
      phases: [
        { index: 1, title: 'Scan' },
        { index: 2, title: 'Sum' },
      ],
      agents: [
        {
          index: 1,
          label: 'one',
          phaseIndex: 1,
          state: 'completed',
          tokens: 26807,
          durationMs: 1771,
          promptPreview: 'Reply with exactly: one',
        },
        {
          index: 2,
          label: 'two',
          phaseIndex: 1,
          state: 'in_progress',
          promptPreview: 'Reply with exactly: two',
        },
      ],
    },
  } as SubagentTask,
];

/**
 * The narrow case the captured run cannot show: labels long enough to compete with the
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

/** The run as it persists today: no running tool, and the placeholder name. */
export const RealWorkflowBeforeFix: Story = { args: { tasks: realWorkflowBeforeFix } };

/** The same run with the fix: the workflow's own name, and its last running agent. */
export const RealWorkflowAfterFix: Story = { args: { tasks: realWorkflowAfterFix } };

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
