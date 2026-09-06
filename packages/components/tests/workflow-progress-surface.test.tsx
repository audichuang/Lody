// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { MessageContent, SessionHistory } from '@lody/shared';
import {
  collectWorkflowTasks,
  WorkflowProgressSurface,
} from '../src/components/sessions/workflow-progress-surface';
import type { SubagentTask } from '../src/components/ai-gui/subagent-task-panel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) => {
      if (typeof options === 'string') return options;
      if (options && typeof options === 'object' && 'defaultValue' in options) {
        return String(options.defaultValue);
      }
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

const history = (items: MessageContent[], id: string): SessionHistory =>
  ({ id, role: 'assistant', timestamp: '2026-09-07T00:00:00.000Z', items }) as SessionHistory;

const workflow = (overrides: Partial<SubagentTask> = {}): SubagentTask => ({
  type: 'subagent_task',
  taskId: 'workflow-1',
  status: 'in_progress',
  actor: 'review-workflow',
  groupProgress: {
    phases: [{ index: 0, title: 'Inspect' }],
    agents: [
      {
        index: 0,
        label: 'reader',
        phaseIndex: 0,
        state: 'in_progress',
        startedAtEpochSeconds: Date.parse('2026-09-07T00:00:00.000Z') / 1000,
      },
    ],
  },
  ...overrides,
});

it('keeps the latest workflow snapshot, including active work from an earlier turn', () => {
  const olderActive = workflow();
  const latest = workflow({ status: 'completed', summary: 'Finished' });
  const ordinary = {
    type: 'subagent_task',
    taskId: 'ordinary-background',
    status: 'in_progress',
  } satisfies MessageContent;

  expect(
    collectWorkflowTasks([
      history([olderActive], 'turn-1'),
      history([ordinary], 'turn-2'),
      history([latest], 'turn-3'),
    ])
  ).toEqual([latest]);

  expect(collectWorkflowTasks([history([olderActive], 'turn-1'), history([], 'turn-2')])).toEqual([
    olderActive,
  ]);
});

it('filters after dedupe so a later hidden snapshot cannot leave stale visible progress', () => {
  const visible = workflow();
  const hiddenLatest = workflow({ groupProgress: undefined, skipTranscript: true });

  expect(
    collectWorkflowTasks([history([visible], 'turn-1'), history([hiddenLatest], 'turn-2')])
  ).toEqual([]);
});

it('expands active phase details and lets the latest completed result expand and dismiss', async () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        createElement(WorkflowProgressSurface, {
          history: [history([workflow()], 'turn-1')],
          isVisible: true,
        })
      );
    });
    const activeToggle = container.querySelector('button[aria-expanded="false"]');
    expect(activeToggle).not.toBeNull();
    expect(container.textContent).toContain('review-workflow');
    expect(container.textContent).not.toContain('reader');

    await act(async () => {
      activeToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('reader');

    const completed = workflow({
      status: 'completed',
      summary: 'All phases complete',
      groupProgress: {
        phases: [{ index: 0, title: 'Inspect' }],
        agents: [
          { index: 0, label: 'reader', phaseIndex: 0, state: 'completed', durationMs: 1200 },
        ],
      },
    });
    await act(async () => {
      root.render(
        createElement(WorkflowProgressSurface, {
          history: [history([completed], 'turn-1')],
        })
      );
    });
    expect(container.textContent).toContain('All phases complete');
    expect(container.textContent).not.toContain('reader');

    const completedToggle = container.querySelector('button[aria-expanded="false"]');
    expect(completedToggle).not.toBeNull();
    await act(async () => {
      completedToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('reader');
    expect(container.textContent).toContain('Inspect');
    expect(container.textContent).toContain('1s');

    const dismiss = container.querySelector('button[aria-label="Dismiss workflow result"]');
    expect(dismiss).not.toBeNull();
    await act(async () => {
      dismiss?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).not.toContain('All phases complete');

    await act(async () => {
      root.render(
        createElement(WorkflowProgressSurface, {
          history: [history([workflow()], 'turn-2')],
        })
      );
    });
    expect(container.textContent).toContain('review-workflow');
    expect(container.querySelector('button[aria-label="Dismiss workflow result"]')).toBeNull();

    await act(async () => {
      root.render(
        createElement(WorkflowProgressSurface, {
          history: [history([{ ...completed, summary: 'Completed again' }], 'turn-3')],
        })
      );
    });
    expect(container.textContent).toContain('Completed again');
  } finally {
    await act(async () => root.unmount());
  }
});
