import type { Meta, StoryObj } from '@storybook/react';
import type { MessageContent, SessionHistory } from '@lody/shared';
import { WorkflowProgressSurface } from '@/components/sessions/workflow-progress-surface';

const makeHistory = (items: MessageContent[], id: string): SessionHistory =>
  ({ id, role: 'assistant', timestamp: '2026-09-07T00:00:00.000Z', items }) as SessionHistory;

const activeWorkflow: MessageContent = {
  type: 'subagent_task',
  taskId: 'story-workflow',
  status: 'in_progress',
  actor: 'repo-review',
  groupProgress: {
    phases: [
      { index: 0, title: 'Inspect' },
      { index: 1, title: 'Report' },
    ],
    agents: [
      {
        index: 0,
        label: 'code-reader',
        phaseIndex: 0,
        state: 'completed',
        durationMs: 12_000,
        tokens: 4200,
      },
      {
        index: 1,
        label: 'test-reader',
        phaseIndex: 0,
        state: 'in_progress',
        startedAtEpochSeconds: (Date.now() - 10_000) / 1000,
      },
      { index: 2, label: 'reporter', phaseIndex: 1, state: 'pending' },
    ],
  },
};

const completedWorkflow: MessageContent = {
  ...activeWorkflow,
  status: 'completed',
  summary: 'Review complete',
  groupProgress: {
    phases: [
      { index: 0, title: 'Inspect' },
      { index: 1, title: 'Report' },
    ],
    agents: [
      { index: 0, label: 'code-reader', phaseIndex: 0, state: 'completed', durationMs: 12_000 },
      { index: 1, label: 'test-reader', phaseIndex: 0, state: 'completed', durationMs: 18_000 },
      { index: 2, label: 'reporter', phaseIndex: 1, state: 'completed', durationMs: 9000 },
    ],
  },
};

const meta = {
  title: 'Sessions/WorkflowProgressSurface',
  component: WorkflowProgressSurface,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="w-[736px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkflowProgressSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {
  args: { history: [makeHistory([activeWorkflow], 'turn-running')] },
};

export const CompletedExpandable: Story = {
  args: { history: [makeHistory([completedWorkflow], 'turn-completed')] },
};
