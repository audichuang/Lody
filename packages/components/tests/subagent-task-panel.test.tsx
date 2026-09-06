// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SubagentTaskPanel, type SubagentTask } from '../src/components/ai-gui/subagent-task-panel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: unknown) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en' },
  }),
}));

it('ticks a running agent from its persisted start, survives remount, and stops at final duration', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-07T00:00:10Z'));
  const container = document.createElement('div');
  const root = createRoot(container);
  const task: SubagentTask = {
    type: 'subagent_task',
    taskId: 'synthetic-clock',
    status: 'in_progress',
    groupProgress: {
      agents: [
        {
          index: 0,
          label: 'reader',
          state: 'in_progress',
          durationMs: 0,
          startedAtEpochSeconds: Date.parse('2026-09-07T00:00:00Z') / 1000,
        },
      ],
    },
  };
  try {
    await act(async () => root.render(createElement(SubagentTaskPanel, { tasks: [task] })));
    expect(container.textContent).toContain('10s');
    await act(async () => vi.advanceTimersByTime(2000));
    expect(container.textContent).toContain('12s');
    await act(async () => root.render(null));
    await act(async () => vi.advanceTimersByTime(3000));
    await act(async () => root.render(createElement(SubagentTaskPanel, { tasks: [task] })));
    expect(container.textContent).toContain('15s');
    const completed: SubagentTask = {
      ...task,
      groupProgress: {
        agents: [{ index: 0, label: 'reader', state: 'completed', durationMs: 14000 }],
      },
    };
    await act(async () => root.render(createElement(SubagentTaskPanel, { tasks: [completed] })));
    await act(async () => vi.advanceTimersByTime(5000));
    expect(container.textContent).toContain('14s');
    const legacy: SubagentTask = {
      ...task,
      groupProgress: {
        agents: [{ index: 0, label: 'reader', state: 'in_progress', tokens: 0, durationMs: 0 }],
      },
    };
    await act(async () => root.render(createElement(SubagentTaskPanel, { tasks: [legacy] })));
    expect(container.textContent).not.toContain('0s');
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
  }
});
