import { z } from 'zod';

import {
  parseSessionNotification,
  type AcpSessionNotification,
  type SubagentTaskPayload,
} from '@lody/shared';

/**
 * Claude Code reports the shape of a running workflow on every `task_progress`, in an
 * undeclared `workflow_progress` array: the declared phases, then one entry per agent with
 * its label, phase, state and cost. None of it survives the adapter's typed task lifecycle
 * message, so Lody asks for the raw SDK message instead (`_claude/sdkMessage`, enabled per
 * session through `_meta.claudeCode.emitRawSDKMessages`) and reads the array here.
 *
 * The array is a live snapshot, not a delta — each tick carries every phase and agent, so
 * the converted value replaces rather than merges.
 */
const WorkflowPhaseSchema = z.object({
  type: z.literal('workflow_phase'),
  index: z.number(),
  title: z.string(),
});

const WorkflowAgentSchema = z
  .object({
    type: z.literal('workflow_agent'),
    index: z.number(),
    label: z.string(),
    state: z.string(),
    phaseIndex: z.number().optional(),
    queuedAt: z.number().optional(),
    startedAt: z.number().optional(),
    tokens: z.number().optional(),
    durationMs: z.number().optional(),
    promptPreview: z.string().optional(),
  })
  .passthrough();

const RawSdkMessageSchema = z
  .object({
    sessionId: z.string().min(1),
    message: z
      .object({
        type: z.literal('system'),
        subtype: z.literal('task_progress'),
        task_id: z.string().min(1),
        tool_use_id: z.string().optional(),
        description: z.string().optional(),
        workflow_progress: z.array(z.unknown()),
      })
      .passthrough(),
  })
  .passthrough();

type GroupAgent = NonNullable<NonNullable<SubagentTaskPayload['groupProgress']>['agents']>[number];

/**
 * Claude Code publishes its own agent state words. The shared contract carries the same
 * state enum a task itself uses, so the provider's vocabulary is normalized here and never
 * reaches `@lody/shared` or the renderer. An unrecognized word means the agent is declared
 * but not yet known to be running — the same thing `pending` already says.
 */
const AGENT_STATES: Record<string, GroupAgent['state']> = {
  start: 'in_progress',
  running: 'in_progress',
  progress: 'in_progress',
  done: 'completed',
  completed: 'completed',
  failed: 'failed',
  error: 'failed',
};

/**
 * A queued agent and a running one share the word `start`; what separates them is that a
 * queued agent has been given a `queuedAt` and not yet a `startedAt`. Reading only the
 * word would show a queued agent as running AND make the queued -> running transition
 * write a byte-identical snapshot, so the panel would not move when the agent actually
 * starts.
 */
const agentState = (agent: {
  state: string;
  queuedAt?: number;
  startedAt?: number;
}): GroupAgent['state'] => {
  const mapped = AGENT_STATES[agent.state] ?? 'pending';
  if (mapped !== 'in_progress') return mapped;
  return agent.startedAt === undefined && agent.queuedAt !== undefined ? 'pending' : 'in_progress';
};

const MAX_PREVIEW_LENGTH = 160;

const preview = (value: string | undefined): string | undefined => {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  if (!trimmed) return undefined;
  return trimmed.length <= MAX_PREVIEW_LENGTH
    ? trimmed
    : `${trimmed.slice(0, MAX_PREVIEW_LENGTH - 1)}…`;
};

const nonNegative = (value: number | undefined): number | undefined =>
  value === undefined || !Number.isFinite(value) || value < 0 ? undefined : value;

export type ClaudeWorkflowProgressConversion =
  | { ok: true; notification: AcpSessionNotification }
  | { ok: false; reason: string };

/**
 * Convert one `_claude/sdkMessage` carrying `workflow_progress` into the same
 * `tool_call_update` the task lifecycle already uses, so the workflow's own
 * `subagent_task` item gains its structure instead of a second row appearing.
 *
 * Returns `{ ok: false }` for every message that is not a workflow progress tick — the
 * caller subscribes to a filtered stream, but the filter is the agent's, not ours.
 */
export const convertClaudeWorkflowProgress = (
  params: unknown
): ClaudeWorkflowProgressConversion => {
  const parsed = RawSdkMessageSchema.safeParse(params);
  if (!parsed.success) return { ok: false, reason: parsed.error.message };

  const { sessionId, message } = parsed.data;
  const phases: { index: number; title: string }[] = [];
  const agents: GroupAgent[] = [];

  for (const entry of message.workflow_progress) {
    const asPhase = WorkflowPhaseSchema.safeParse(entry);
    if (asPhase.success) {
      phases.push({ index: asPhase.data.index, title: asPhase.data.title });
      continue;
    }
    const asAgent = WorkflowAgentSchema.safeParse(entry);
    if (!asAgent.success) continue;
    const a = asAgent.data;
    agents.push({
      index: a.index,
      label: a.label,
      state: agentState(a),
      ...(a.phaseIndex !== undefined ? { phaseIndex: a.phaseIndex } : {}),
      ...(nonNegative(a.tokens) !== undefined ? { tokens: nonNegative(a.tokens) } : {}),
      ...(nonNegative(a.durationMs) !== undefined ? { durationMs: nonNegative(a.durationMs) } : {}),
      ...(preview(a.promptPreview) !== undefined ? { promptPreview: preview(a.promptPreview) } : {}),
    });
  }

  if (phases.length === 0 && agents.length === 0) {
    return { ok: false, reason: 'workflow_progress carried no phases or agents' };
  }

  const groupProgress = buildGroupProgress({ phases, agents });

  try {
    return {
      ok: true,
      notification: parseSessionNotification({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: `task:${message.task_id}`,
          kind: 'think',
          status: 'in_progress',
          _meta: {
            lody: {
              task: {
                version: 1,
                taskId: message.task_id,
                status: 'in_progress',
                // `kind` is required by the shared schema and every workflow that
                // publishes `workflow_progress` is a background task, so this re-asserts
                // what the lifecycle events already say rather than inventing a value.
                kind: 'background',
                ...(message.tool_use_id ? { parentToolCallId: message.tool_use_id } : {}),
                groupProgress,
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

const buildGroupProgress = (value: {
  phases: { index: number; title: string }[];
  agents: GroupAgent[];
}) => ({
  ...(value.phases.length > 0 ? { phases: value.phases } : {}),
  ...(value.agents.length > 0 ? { agents: value.agents } : {}),
});
