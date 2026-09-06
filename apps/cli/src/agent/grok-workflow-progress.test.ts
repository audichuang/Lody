import { applyNotificationOnHistory } from '@lody/shared';
import { describe, expect, it } from 'vitest';

import { convertGrokWorkflowProgress } from './grok-workflow-progress';

// Synthetic, but shaped exactly like Grok 1.0.13's `workflow_updated`: run-level bookkeeping
// Lody never reads sits beside the phases and agents it does.
const snapshot = (update: Record<string, unknown> = {}) => ({
  sessionId: 'acp-session-1',
  update: {
    sessionUpdate: 'workflow_updated',
    run_id: 'wf_run-1',
    revision: 7,
    name: 'nightly-audit',
    objective: 'Audit the dependency tree',
    status: 'active',
    foreground: false,
    phases: [
      { title: 'Scan', state: 'done' },
      { title: 'Report', state: 'active' },
    ],
    current_phase: 'Report',
    agent_budget: 128,
    agents_used: 2,
    agents_remaining: 126,
    elapsed_ms: 5321,
    active_agents: 1,
    agents: [
      {
        agent_id: 'a-1',
        label: 'scan-deps',
        phase: 'Scan',
        model: 'grok-4.6',
        state: 'done',
        tokens_used: 6904,
        duration_ms: 2559,
      },
      { agent_id: 'a-2', label: 'write-report', phase: 'Report', state: 'running' },
    ],
    last_event: 'agent_started',
    ...update,
  },
  _meta: { eventId: 'acp-session-1-4' },
});

type Task = Record<string, unknown> & {
  groupProgress?: { phases?: unknown[]; agents?: Record<string, unknown>[] };
};

const convert = (params: unknown) => {
  const result = convertGrokWorkflowProgress(params);
  if (!result.ok) throw new Error(`expected a conversion, got: ${result.reason}`);
  return result.notification;
};

const taskOf = (params: unknown): Task =>
  (convert(params).update as { _meta?: { lody?: { task?: Task } } })._meta?.lody?.task as Task;

describe('convertGrokWorkflowProgress', () => {
  it('maps one snapshot onto the shared task row and the agents under it', () => {
    const notification = convert(snapshot());

    expect(notification.sessionId).toBe('acp-session-1');
    expect(notification.update).toMatchObject({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'task:wf_run-1',
      status: 'in_progress',
    });
    expect(taskOf(snapshot())).toEqual({
      version: 1,
      taskId: 'wf_run-1',
      status: 'in_progress',
      kind: 'background',
      actor: 'nightly-audit',
      description: 'Audit the dependency tree',
      groupProgress: {
        phases: [
          { index: 0, title: 'Scan' },
          { index: 1, title: 'Report' },
        ],
        agents: [
          {
            index: 0,
            label: 'scan-deps',
            phaseIndex: 0,
            state: 'completed',
            tokens: 6904,
            durationMs: 2559,
          },
          { index: 1, label: 'write-report', phaseIndex: 1, state: 'in_progress' },
        ],
      },
    });
  });

  it("normalizes Grok's run and agent state words into the shared task status enum", () => {
    const statusFor = (status: string) => taskOf(snapshot({ status })).status;
    expect(statusFor('complete')).toBe('completed');
    expect(statusFor('failed')).toBe('failed');
    expect(statusFor('cancelled')).toBe('failed');
    expect(statusFor('interrupted')).toBe('failed');
    // Paused variants and words this producer has never published keep the row alive.
    expect(statusFor('user_paused')).toBe('in_progress');
    expect(statusFor('budget_limited')).toBe('in_progress');
    expect(statusFor('brand_new_word')).toBe('in_progress');

    const agents = taskOf(
      snapshot({
        agents: [
          { agent_id: 'a', label: 'a', state: 'cancelled' },
          { agent_id: 'b', label: 'b', state: 'failed' },
          { agent_id: 'c', label: 'c', state: 'mystery' },
        ],
      })
    ).groupProgress?.agents;
    expect(agents?.map((agent) => agent.state)).toEqual(['failed', 'failed', 'pending']);
  });

  it('carries the result summary once the run completes and marks a foreground run a subagent', () => {
    const task = taskOf(
      snapshot({ status: 'complete', foreground: true, result_summary: '  all  clear ' })
    );
    expect(task).toMatchObject({ status: 'completed', kind: 'subagent', summary: 'all clear' });
  });

  it('leaves an agent whose phase was never declared for the panel to list as an orphan', () => {
    const agents = taskOf(
      snapshot({
        agents: [{ agent_id: 'a', label: 'stray', phase: 'Unplanned', state: 'running' }],
      })
    ).groupProgress?.agents;
    expect(agents).toEqual([{ index: 0, label: 'stray', state: 'in_progress' }]);
  });

  it('drops provider fields no surface reads instead of persisting them', () => {
    const task = taskOf(snapshot());
    for (const key of ['revision', 'agent_budget', 'agents_used', 'elapsed_ms', 'last_event']) {
      expect(task).not.toHaveProperty(key);
    }
    expect(task.groupProgress?.agents?.[0]).not.toHaveProperty('agent_id');
    expect(task.groupProgress?.agents?.[0]).not.toHaveProperty('model');
    // A run that has declared nothing yet is still a row, just one without a group.
    expect(taskOf(snapshot({ phases: [], agents: [] }))).not.toHaveProperty('groupProgress');
  });

  it('rejects every other event on the same Grok method', () => {
    const spawned = convertGrokWorkflowProgress({
      sessionId: 'acp-session-1',
      update: {
        sessionUpdate: 'subagent_spawned',
        subagent_id: 'a-1',
        description: 'scan-deps',
        workflow_run_id: 'wf_run-1',
      },
    });
    expect(spawned.ok).toBe(false);
    if (!spawned.ok) expect(spawned.reason).toBe('not a workflow snapshot: subagent_spawned');
    // A payload that has every workflow field but a different event name is still not one.
    expect(convertGrokWorkflowProgress(snapshot({ sessionUpdate: 'subagent_finished' })).ok).toBe(
      false
    );
    expect(convertGrokWorkflowProgress({ sessionId: 'acp-session-1' }).ok).toBe(false);
    // A real snapshot with a broken field reports the field, not a multi-line dump.
    const broken = convertGrokWorkflowProgress(snapshot({ run_id: 42 }));
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.reason.split('\n')).toHaveLength(1);
  });

  it('materializes the workflow row from the first snapshot, with no tool_call before it', () => {
    // Grok's adapter emits no task lifecycle, so the snapshot is the only thing that can
    // create the row. Later revisions must replace the group and finally settle the row.
    const first = convert(snapshot({ revision: 1, phases: [{ title: 'Scan' }], agents: [] }));
    const second = convert(snapshot());
    const last = convert(
      snapshot({
        status: 'complete',
        result_summary: 'audit done',
        agents: [
          { agent_id: 'a-1', label: 'scan-deps', phase: 'Scan', state: 'done', tokens_used: 6904 },
          {
            agent_id: 'a-2',
            label: 'write-report',
            phase: 'Report',
            state: 'done',
            tokens_used: 3,
          },
        ],
      })
    );

    const afterFirst = applyNotificationOnHistory([], [first]);
    const row = afterFirst[0]?.items?.find((item) => item.type === 'subagent_task');
    expect(row).toMatchObject({
      taskId: 'wf_run-1',
      status: 'in_progress',
      actor: 'nightly-audit',
    });

    const settled = applyNotificationOnHistory(afterFirst, [second, last]);
    const tasks = settled.flatMap((entry) =>
      (entry.items ?? []).filter((item) => item.type === 'subagent_task')
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      status: 'completed',
      summary: 'audit done',
      groupProgress: {
        agents: [
          { label: 'scan-deps', state: 'completed' },
          { label: 'write-report', state: 'completed' },
        ],
      },
    });
  });
});
