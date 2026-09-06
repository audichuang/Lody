import { z } from 'zod';

import { parseSessionNotification, type SubagentTaskPayload } from '@lody/shared';

import type { WorkflowProgressConversion } from './claude-workflow-progress';

/**
 * Grok reports a running workflow as `_x.ai/session_notification :: workflow_updated`: one
 * complete snapshot per revision, carrying the declared phases and one entry per agent
 * spawned so far. The Grok adapter is a pass-through proxy with no task lifecycle of its
 * own, so nothing else registers the workflow — the first snapshot creates the
 * `subagent_task` row and every later one replaces its structure (the history applier
 * merges by `taskId`, and pushes a row it has never seen).
 *
 * Only the live method is read. Replays after `session/load` ride `_x.ai/session/update`,
 * which the central parser does not match, so they are ignored before reaching here; the
 * row they describe is already in Lody's own persisted history.
 */
const WorkflowUpdatedSchema = z
  .object({
    sessionId: z.string().min(1),
    update: z
      .object({
        sessionUpdate: z.literal('workflow_updated'),
        run_id: z.string().min(1),
        revision: z.number().int().nonnegative(),
        name: z.string().optional(),
        objective: z.string().optional(),
        status: z.string(),
        foreground: z.boolean().optional(),
        // `phases[].state` (pending / active / done) has no home in the neutral shape; the
        // panel derives phase progress from its agents instead.
        phases: z.array(z.object({ title: z.string() }).passthrough()).optional(),
        agents: z
          .array(
            z
              .object({
                label: z.string(),
                phase: z.string().optional(),
                state: z.string(),
                tokens_used: z.number().nonnegative().optional(),
                duration_ms: z.number().nonnegative().optional(),
              })
              .passthrough()
          )
          .optional(),
        result_summary: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

type TaskStatus = SubagentTaskPayload['status'];
type GroupAgent = NonNullable<NonNullable<SubagentTaskPayload['groupProgress']>['agents']>[number];

/**
 * Grok's `WorkflowRunStatus` has four terminal members; its paused, blocked and
 * budget-limited variants describe a run that is still alive, and so does any word this
 * producer has never published — a row must never settle on a status it does not know.
 */
const RUN_STATUSES: Record<string, TaskStatus> = {
  complete: 'completed',
  failed: 'failed',
  cancelled: 'failed',
  interrupted: 'failed',
};

/**
 * Grok agents report `running` / `done` / `failed` / `cancelled`. The shared enum has no
 * cancelled, so it reads as failed; an unknown word means the agent is declared but not yet
 * known to be running, which is what `pending` already says.
 */
const AGENT_STATES: Record<string, TaskStatus> = {
  running: 'in_progress',
  done: 'completed',
  failed: 'failed',
  cancelled: 'failed',
};

/** The method also carries subagent and housekeeping events; answer those in one short line. */
const SessionUpdateProbe = z.object({ update: z.object({ sessionUpdate: z.string() }) });

const firstIssue = (error: z.ZodError): string =>
  error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');

const clean = (value: string | undefined, maxLength: number): string | undefined => {
  const text = value?.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
};

/**
 * Convert one `workflow_updated` snapshot into the same `tool_call_update` the task
 * lifecycle uses, so a Grok workflow gets one `subagent_task` row with its agents under it.
 *
 * Returns `{ ok: false }` for every other Grok session notification — the method carries
 * subagent and housekeeping events too, and only the workflow snapshot has a surface here.
 */
export const convertGrokWorkflowProgress = (params: unknown): WorkflowProgressConversion => {
  const probe = SessionUpdateProbe.safeParse(params);
  const sessionUpdate = probe.success ? probe.data.update.sessionUpdate : undefined;
  if (sessionUpdate !== 'workflow_updated') {
    return { ok: false, reason: `not a workflow snapshot: ${sessionUpdate ?? 'no sessionUpdate'}` };
  }
  const parsed = WorkflowUpdatedSchema.safeParse(params);
  if (!parsed.success) return { ok: false, reason: firstIssue(parsed.error) };
  const { sessionId, update } = parsed.data;

  // Grok identifies phases by title and agents by id; the neutral shape wants integer
  // indexes, so array position stands in and an agent's phase resolves by title. A title the
  // script never declared leaves `phaseIndex` unset, which the panel lists as an orphan
  // rather than losing the agent.
  const phases = (update.phases ?? []).map((phase, index) => ({ index, title: phase.title }));
  const agents: GroupAgent[] = (update.agents ?? []).map((agent, index) => {
    const phaseIndex = phases.findIndex((phase) => phase.title === agent.phase);
    return {
      index,
      label: agent.label,
      state: AGENT_STATES[agent.state] ?? 'pending',
      ...(phaseIndex >= 0 ? { phaseIndex } : {}),
      ...(agent.tokens_used !== undefined ? { tokens: agent.tokens_used } : {}),
      ...(agent.duration_ms !== undefined ? { durationMs: agent.duration_ms } : {}),
    };
  });

  const status = RUN_STATUSES[update.status] ?? 'in_progress';
  const actor = clean(update.name, 160);
  const description = clean(update.objective, 2_000);
  const summary = clean(update.result_summary, 2_000);
  const groupProgress = {
    ...(phases.length > 0 ? { phases } : {}),
    ...(agents.length > 0 ? { agents } : {}),
  };

  try {
    return {
      ok: true,
      notification: parseSessionNotification({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: `task:${update.run_id}`,
          kind: 'think',
          status,
          _meta: {
            lody: {
              task: {
                version: 1,
                taskId: update.run_id,
                snapshotRevision: update.revision,
                status,
                // `kind` is required by the shared schema; Grok's `foreground` flag is the
                // same fact. Grok serializes it on every snapshot (serde default false), so
                // the absent case only mirrors that default.
                kind: update.foreground === true ? 'subagent' : 'background',
                ...(actor !== undefined ? { actor } : {}),
                ...(description !== undefined ? { description } : {}),
                ...(summary !== undefined ? { summary } : {}),
                ...(Object.keys(groupProgress).length > 0 ? { groupProgress } : {}),
              },
            },
          },
        },
      }),
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
};
