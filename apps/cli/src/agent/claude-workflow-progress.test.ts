import { describe, expect, it } from 'vitest';

import { convertClaudeWorkflowProgress } from './claude-workflow-progress';

const rawMessage = (workflowProgress: unknown[]) => ({
  sessionId: 'acp-session-1',
  message: {
    type: 'system',
    subtype: 'task_progress',
    task_id: 'task-1',
    tool_use_id: 'tool-1',
    workflow_progress: workflowProgress,
  },
});

const groupProgressOf = (params: unknown) => {
  const result = convertClaudeWorkflowProgress(params);
  if (!result.ok) throw new Error(`expected a conversion, got: ${result.reason}`);
  const task = (
    result.notification.update as {
      _meta?: { lody?: { task?: { groupProgress?: unknown } } };
    }
  )._meta?.lody?.task;
  return task?.groupProgress as
    | { phases?: unknown[]; agents?: Record<string, unknown>[] }
    | undefined;
};

describe('convertClaudeWorkflowProgress', () => {
  it("normalizes the provider's agent state words into the shared task status enum", () => {
    const groupProgress = groupProgressOf(
      rawMessage([
        { type: 'workflow_phase', index: 1, title: 'Scan' },
        { type: 'workflow_agent', index: 1, label: 'one', state: 'done', phaseIndex: 1 },
        { type: 'workflow_agent', index: 2, label: 'two', state: 'start', phaseIndex: 1 },
        { type: 'workflow_agent', index: 3, label: 'three', state: 'error', phaseIndex: 1 },
        // A word this producer has never published must not read as running.
        { type: 'workflow_agent', index: 4, label: 'four', state: 'queued', phaseIndex: 1 },
      ])
    );

    expect(groupProgress?.phases).toEqual([{ index: 1, title: 'Scan' }]);
    expect(groupProgress?.agents?.map((agent) => agent.state)).toEqual([
      'completed',
      'in_progress',
      'failed',
      'pending',
    ]);
  });

  it('drops provider fields no surface reads instead of persisting them', () => {
    const groupProgress = groupProgressOf(
      rawMessage([
        {
          type: 'workflow_agent',
          index: 1,
          label: 'one',
          state: 'done',
          model: 'a-model-id',
          toolCalls: 3,
          resultPreview: 'the whole answer',
          tokens: 26807,
          durationMs: 1771,
          promptPreview: '  Reply with\n  exactly: one  ',
        },
      ])
    );

    expect(groupProgress?.agents?.[0]).toEqual({
      index: 1,
      label: 'one',
      state: 'completed',
      tokens: 26807,
      durationMs: 1771,
      promptPreview: 'Reply with exactly: one',
    });
  });

  it('rejects a message whose workflow_progress carries nothing renderable', () => {
    expect(convertClaudeWorkflowProgress(rawMessage([{ type: 'something_else' }]))).toMatchObject({
      ok: false,
    });
    expect(convertClaudeWorkflowProgress({ sessionId: 'acp-session-1' })).toMatchObject({
      ok: false,
    });
  });

  it('separates a queued agent from a running one by its timestamps', () => {
    const tick = (agents: Record<string, unknown>[]) =>
      convertClaudeWorkflowProgress({
        sessionId: 'acp-session',
        message: {
          type: 'system',
          subtype: 'task_progress',
          task_id: 't1',
          workflow_progress: [
            { type: 'workflow_phase', index: 1, title: 'Scan' },
            ...agents.map((a, i) => ({
              type: 'workflow_agent',
              index: i + 1,
              label: `a${i + 1}`,
              phaseIndex: 1,
              state: 'start',
              ...a,
            })),
          ],
        },
      });

    // Both agents say `start`; only the timestamps say which one is actually running.
    const queued = tick([{ queuedAt: 1000 }]);
    const running = tick([{ queuedAt: 1000, startedAt: 1200 }]);
    expect(queued.ok && running.ok).toBe(true);
    if (!queued.ok || !running.ok) return;

    const stateOf = (r: typeof queued) =>
      (r.ok &&
        (
          r.notification.update as {
            _meta?: { lody?: { task?: { groupProgress?: { agents?: { state: string }[] } } } };
          }
        )._meta?.lody?.task?.groupProgress?.agents?.[0]?.state) ||
      undefined;

    expect(stateOf(queued)).toBe('pending');
    expect(stateOf(running)).toBe('in_progress');
    // The transition must change the stored snapshot, or the panel never moves.
    expect(JSON.stringify(queued.notification)).not.toBe(JSON.stringify(running.notification));
  });
});
