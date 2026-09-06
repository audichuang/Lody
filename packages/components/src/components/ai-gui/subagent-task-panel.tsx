import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronRight, CircleDashed, Loader2, X } from 'lucide-react';
import type { MessageContent } from '@lody/shared';
import { formatCompactNumber } from '@/lib/format-compact-number';
import { formatDurationCompact, type DurationUnitLabels } from '@/lib/format-duration';
import { toIntlLocaleOrEn } from '@/lib/intl-locale';
import { cn } from '@/lib/utils';
import { Badge } from '@/ui/badge';

/**
 * Renders the subagent/background tasks a turn spawned as a single grouped
 * panel, instead of leaking each lifecycle event into the inline transcript.
 *
 * Tasks are persisted as first-class `subagent_task` history items (merged by
 * `taskId`); this panel is a pure view-layer aggregation — it reads those items
 * off the assistant entry and never mutates persisted history.
 */

export type SubagentTask = Extract<MessageContent, { type: 'subagent_task' }>;

const isRunning = (task: SubagentTask): boolean =>
  task.status === 'in_progress' || task.status === 'pending';

/**
 * Extract subagent tasks from an assistant entry's items, in first-seen order,
 * deduped by taskId. Ambient/housekeeping tasks (`skipTranscript`) are omitted
 * from the inline panel per the SDK's guidance.
 */
export const collectSubagentTasks = (items: readonly MessageContent[]): SubagentTask[] => {
  const byId = new Map<string, SubagentTask>();
  for (const item of items) {
    if (item.type !== 'subagent_task' || item.skipTranscript) continue;
    byId.set(item.taskId, item);
  }
  return [...byId.values()];
};

/**
 * Compact units follow the product language, never the host OS locale — see
 * `lib/format-compact-number.ts`. Both the task row and the agent rows below format
 * tokens through here so the two cannot drift apart.
 */
const formatTokens = (value: number, locale: string): string => formatCompactNumber(value, locale);

/** Locale and duration words for every number this panel prints. */
const useNumberFormatting = () => {
  const { t, i18n } = useTranslation();
  return {
    locale: toIntlLocaleOrEn(i18n.resolvedLanguage ?? i18n.language),
    durationUnits: {
      hour: t('time.unitShort.hour', 'h'),
      minute: t('time.unitShort.minute', 'm'),
      second: t('time.unitShort.second', 's'),
    } satisfies DurationUnitLabels,
  };
};

const formatUsage = (usage: SubagentTask['usage'], locale: string): string | null => {
  if (!usage) return null;
  const parts: string[] = [];
  if (typeof usage.totalTokens === 'number') {
    parts.push(`${formatTokens(usage.totalTokens, locale)} tokens`);
  }
  if (typeof usage.toolUses === 'number') {
    parts.push(`${usage.toolUses} ${usage.toolUses === 1 ? 'tool' : 'tools'}`);
  }
  return parts.length ? parts.join(' · ') : null;
};

/**
 * One state vocabulary for a task and for the agents inside it. Shape carries the meaning
 * and colour only reinforces it, so the state survives a colour-blind reader and a 12px row.
 */
const StatusIcon = ({
  status,
  className,
}: {
  status: SubagentTask['status'];
  className: string;
}) => {
  const shared = cn('flex-none shrink-0', className);
  if (status === 'completed') return <Check className={cn(shared, 'text-status-success')} />;
  if (status === 'failed') return <X className={cn(shared, 'text-status-danger')} />;
  if (status === 'pending') return <CircleDashed className={cn(shared, 'text-muted-foreground')} />;
  return <Loader2 className={cn(shared, 'animate-spin text-muted-foreground')} />;
};

const SubagentTaskRow = ({ task }: { task: SubagentTask }) => {
  const { t } = useTranslation();

  const actor =
    task.actor ||
    task.subagentType ||
    task.workflowName ||
    (task.taskType === 'local_bash'
      ? t('sessions.subagentTasks.bashActor', 'Bash')
      : t('sessions.subagentTasks.defaultActor', 'Task'));

  // A summary that just wraps the description (the synthesized background-command
  // "…description… completed" text) is noise next to the description column — drop it.
  const description = task.description?.trim();
  const summary = task.summary?.trim();
  const meaningfulSummary =
    summary && (!description || !summary.includes(description)) ? summary : undefined;

  let action: string | null;
  if (task.status === 'failed') {
    action = task.error || t('sessions.subagentTasks.failed', 'Failed');
  } else if (task.status === 'completed') {
    action = meaningfulSummary || t('sessions.subagentTasks.done', 'Done');
  } else if (task.lastToolName) {
    action = t('sessions.subagentTasks.runningTool', 'Running {{tool}}', {
      tool: task.lastToolName,
    });
  } else {
    action = meaningfulSummary || t('sessions.subagentTasks.working', 'Working…');
  }

  const { locale } = useNumberFormatting();
  const usageLabel = task.status === 'completed' ? formatUsage(task.usage, locale) : null;

  return (
    <div className="flex flex-col gap-0.5 py-1">
      <div className="flex min-w-0 items-center gap-1.5 text-[13px] leading-tight">
        <StatusIcon status={task.status} className="h-3.5 w-3.5" />
        <span className="shrink-0 font-medium text-foreground">{actor}</span>
        {task.description ? (
          <>
            <span className="shrink-0 text-muted-foreground/60">·</span>
            <span
              className="min-w-0 flex-1 truncate text-muted-foreground"
              title={task.description}
            >
              {task.description}
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        {task.isBackgrounded ? (
          <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px] font-medium">
            {t('sessions.subagentTasks.background', 'Background')}
          </Badge>
        ) : null}
        {action ? (
          <span
            className={cn(
              'max-w-[45%] shrink-0 truncate text-xs',
              task.status === 'failed' ? 'text-status-danger' : 'text-muted-foreground'
            )}
            title={action}
          >
            {action}
          </span>
        ) : null}
      </div>
      {usageLabel ? (
        <span className="pl-5 text-[11px] font-mono tabular-nums text-muted-foreground/70">
          {usageLabel}
        </span>
      ) : null}
    </div>
  );
};

type GroupAgent = NonNullable<NonNullable<SubagentTask['groupProgress']>['agents']>[number];

const agentMeta = (
  agent: GroupAgent,
  locale: string,
  durationUnits: DurationUnitLabels,
  now: number,
  settled: boolean
): string | null => {
  const parts: string[] = [];
  const running = agent.state === 'in_progress';
  if (typeof agent.tokens === 'number' && (!running || agent.tokens > 0))
    parts.push(formatTokens(agent.tokens, locale));
  const durationMs =
    running && !settled && agent.startedAtEpochSeconds !== undefined
      ? Math.max(agent.durationMs ?? 0, now - agent.startedAtEpochSeconds * 1000)
      : agent.durationMs;
  if (typeof durationMs === 'number' && (!running || durationMs > 0)) {
    const duration = formatDurationCompact(durationMs, durationUnits);
    if (duration) parts.push(duration);
  }
  return parts.length ? parts.join(' · ') : null;
};

/**
 * The identity column is the one that truncates, so a long agent label degrades to an
 * ellipsis instead of pushing the row past its container — the panel body's `overflow-y`
 * would otherwise turn the overflow into a second horizontal scroller.
 *
 * `settled` is the parent task's: the terminal lifecycle event carries no group progress,
 * so the last tick before it can leave an agent reading as in flight forever. On a settled
 * task that reads as unknown rather than running — never as success the run never reported.
 */
const AgentRow = ({
  agent,
  settled,
  now,
}: {
  agent: GroupAgent;
  settled: boolean;
  now: number;
}) => {
  const { locale, durationUnits } = useNumberFormatting();
  const meta = agentMeta(agent, locale, durationUnits, now, settled);
  return (
    <div className="flex min-w-0 items-center gap-1.5 py-0.5 text-[12px] leading-tight">
      <StatusIcon
        status={settled && agent.state === 'in_progress' ? 'pending' : agent.state}
        className="size-3"
      />
      <span className="min-w-0 flex-1 truncate font-mono leading-5">
        <span className="font-medium text-foreground">{agent.label}</span>
        {agent.promptPreview ? (
          <span className="ml-1.5 text-[11px] text-muted-foreground/70">{agent.promptPreview}</span>
        ) : null}
      </span>
      {meta ? (
        <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70">
          {meta}
        </span>
      ) : null}
    </div>
  );
};

/**
 * A task that orchestrates other agents publishes their structure in `groupProgress`.
 * Render it under the task's own row so the children read as part of it, rather than as
 * sibling tasks the session never registered.
 */
const SubagentTaskGroup = ({ task }: { task: SubagentTask }) => {
  const { t } = useTranslation();
  const agents = task.groupProgress?.agents ?? [];
  const phases = task.groupProgress?.phases ?? [];
  const settled = task.status === 'completed' || task.status === 'failed';
  const ticking =
    !settled &&
    agents.some(
      (agent) => agent.state === 'in_progress' && agent.startedAtEpochSeconds !== undefined
    );
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  if (agents.length === 0) return null;
  const buckets = phases.length
    ? phases.map((phase) => ({
        key: `phase-${phase.index}`,
        title: phase.title,
        agents: agents.filter((agent) => agent.phaseIndex === phase.index),
      }))
    : [{ key: 'all', title: null, agents }];
  const orphans = phases.length
    ? agents.filter((agent) => !phases.some((phase) => phase.index === agent.phaseIndex))
    : [];

  return (
    <div className="mt-0.5 flex flex-col gap-0.5 pb-1 pl-5">
      {buckets.map((bucket) => (
        <div key={bucket.key} className="flex flex-col">
          {bucket.title ? (
            <div className="flex items-center gap-1.5 pb-0.5 pt-1 text-[10px] font-mono uppercase tracking-wide text-muted-foreground/70">
              <span className="truncate">{bucket.title}</span>
              <span className="h-px flex-1 bg-border/50" />
              <span className="flex-none tabular-nums">
                {bucket.agents.filter((agent) => agent.state === 'completed').length}/
                {bucket.agents.length}
              </span>
            </div>
          ) : null}
          {bucket.agents.length === 0 ? (
            <span className="py-0.5 text-[11px] text-muted-foreground/60">
              {t('sessions.subagentTasks.phasePending', 'Not started')}
            </span>
          ) : (
            bucket.agents.map((agent) => (
              <AgentRow
                key={`${bucket.key}-${agent.index}`}
                agent={agent}
                settled={settled}
                now={now}
              />
            ))
          )}
        </div>
      ))}
      {orphans.map((agent) => (
        <AgentRow key={`orphan-${agent.index}`} agent={agent} settled={settled} now={now} />
      ))}
    </div>
  );
};

export const SubagentTaskPanel = ({ tasks }: { tasks: readonly SubagentTask[] }) => {
  const { t } = useTranslation();
  const runningCount = useMemo(() => tasks.filter(isRunning).length, [tasks]);
  const hasRunning = runningCount > 0;
  const [userExpanded, setUserExpanded] = useState(false);

  if (tasks.length === 0) return null;

  // While work is in flight the panel stays open (live status). Once every task
  // has settled it collapses to a one-line summary the user can expand.
  const expanded = hasRunning || userExpanded;
  const canToggle = !hasRunning;

  const headerLabel = hasRunning
    ? t('sessions.subagentTasks.waiting', { count: runningCount })
    : t('sessions.subagentTasks.count', { count: tasks.length });

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 px-2 py-1.5">
      <button
        type="button"
        className={cn(
          'group flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-muted-foreground transition-colors',
          canToggle ? 'cursor-pointer hover:text-foreground' : 'cursor-default'
        )}
        onClick={canToggle ? () => setUserExpanded((prev) => !prev) : undefined}
        aria-expanded={canToggle ? expanded : undefined}
      >
        {hasRunning ? (
          <Loader2 className="h-3.5 w-3.5 flex-none shrink-0 animate-spin" />
        ) : (
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 flex-none shrink-0 opacity-70 transition-transform duration-200 group-hover:opacity-100',
              expanded ? 'rotate-90' : ''
            )}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{headerLabel}</span>
      </button>
      {expanded ? (
        <div className="scrollbar-pro mt-0.5 max-h-[22rem] divide-y divide-border/40 overflow-y-auto pl-1 pr-1">
          {tasks.map((task) => (
            <div key={task.taskId}>
              <SubagentTaskRow task={task} />
              <SubagentTaskGroup task={task} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};
