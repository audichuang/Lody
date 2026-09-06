import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronRight, Loader2, X } from 'lucide-react';
import type { SessionHistory } from '@lody/shared';
import { SubagentTaskDetails, type SubagentTask } from '@/components/ai-gui/subagent-task-panel';
import { ConversationColumn } from '@/components/shared/conversation-column';
import { cn } from '@/lib/utils';

const isWorkflowRunning = (task: SubagentTask): boolean =>
  task.status === 'in_progress' || task.status === 'pending';

/** Select the latest visible workflow snapshot for every task in this session. */
export const collectWorkflowTasks = (history: readonly SessionHistory[]): SubagentTask[] => {
  const latest = new Map<string, SubagentTask>();
  for (const entry of history) {
    for (const item of entry.items ?? []) {
      if (item.type !== 'subagent_task') continue;
      latest.delete(item.taskId);
      latest.set(item.taskId, item);
    }
  }
  return [...latest.values()].filter(
    (task) => task.groupProgress !== undefined && task.skipTranscript !== true
  );
};

const workflowName = (task: SubagentTask, fallback: string): string =>
  task.workflowName?.trim() || task.actor?.trim() || task.description?.trim() || fallback;

const workflowPhase = (task: SubagentTask): string | null => {
  const phases = task.groupProgress?.phases ?? [];
  const agents = task.groupProgress?.agents ?? [];
  const currentAgent = agents.find((agent) => agent.state === 'in_progress');
  const currentPhaseIndex =
    currentAgent?.phaseIndex ?? agents.find((agent) => agent.state === 'pending')?.phaseIndex;
  return (
    phases.find((phase) => phase.index === currentPhaseIndex)?.title ??
    (isWorkflowRunning(task) ? phases[0]?.title : null) ??
    null
  );
};

const workflowCounts = (task: SubagentTask) => {
  const agents = task.groupProgress?.agents ?? [];
  return {
    done: agents.filter((agent) => agent.state === 'completed').length,
    running: agents.filter((agent) => agent.state === 'in_progress').length,
  };
};

const statusLabel = (
  task: SubagentTask,
  t: (key: string, options: { defaultValue: string }) => string
): string => {
  if (task.status === 'completed') {
    return t('sessions.workflowProgress.completed', { defaultValue: 'Completed' });
  }
  if (task.status === 'failed') {
    return t('sessions.workflowProgress.failed', { defaultValue: 'Failed' });
  }
  if (task.status === 'pending') {
    return t('sessions.workflowProgress.pending', { defaultValue: 'Pending' });
  }
  return t('sessions.workflowProgress.running', { defaultValue: 'Running' });
};

export function WorkflowProgressSurface({
  history,
  isVisible = true,
}: {
  history: readonly SessionHistory[];
  isVisible?: boolean;
}) {
  const { t } = useTranslation();
  const tasks = useMemo(() => collectWorkflowTasks(history), [history]);
  const activeTasks = tasks.filter(isWorkflowRunning);
  const latestCompleted = activeTasks.length > 0 ? null : (tasks.at(-1) ?? null);
  const [activeExpanded, setActiveExpanded] = useState(false);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [dismissedTaskId, setDismissedTaskId] = useState<string | null>(null);
  if (dismissedTaskId && activeTasks.some((task) => task.taskId === dismissedTaskId)) {
    setDismissedTaskId(null);
  }

  if (activeTasks.length > 0) {
    return (
      <div className="w-full shrink-0 pb-1.5">
        <ConversationColumn>
          <button
            type="button"
            className="flex w-full items-start gap-1.5 rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted/30"
            aria-expanded={activeExpanded}
            onClick={() => setActiveExpanded((value) => !value)}
          >
            {activeExpanded ? (
              <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 rotate-90 text-muted-foreground" />
            ) : (
              <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 space-y-0.5">
              {activeTasks.map((task) => {
                const counts = workflowCounts(task);
                const phase = workflowPhase(task);
                return (
                  <span key={task.taskId} className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium text-foreground">
                      {workflowName(
                        task,
                        t('sessions.workflowProgress.defaultName', { defaultValue: 'Workflow' })
                      )}
                    </span>
                    <span className="truncate text-muted-foreground">
                      {phase ? `${phase} · ${statusLabel(task, t)}` : statusLabel(task, t)}
                    </span>
                    {counts.done > 0 || counts.running > 0 ? (
                      <span className="shrink-0 tabular-nums text-muted-foreground/70">
                        {t('sessions.workflowProgress.counts', {
                          ...counts,
                          defaultValue: '{{done}} done · {{running}} running',
                        })}
                      </span>
                    ) : null}
                  </span>
                );
              })}
            </span>
          </button>
          {activeExpanded ? (
            <div className="scrollbar-pro mt-1 max-h-56 overflow-y-auto rounded-lg border border-border/40 bg-card/20 px-2">
              {activeTasks.map((task) => (
                <div key={task.taskId} className="border-b border-border/40 last:border-b-0">
                  <SubagentTaskDetails task={task} isVisible={isVisible} />
                </div>
              ))}
            </div>
          ) : null}
        </ConversationColumn>
      </div>
    );
  }

  if (!latestCompleted || latestCompleted.taskId === dismissedTaskId) return null;

  return (
    <div className="w-full shrink-0 pb-1.5">
      <ConversationColumn>
        <div className="flex items-center gap-1.5">
          {latestCompleted.status === 'failed' ? (
            <X className="h-3.5 w-3.5 shrink-0 text-status-danger" />
          ) : (
            <Check className="h-3.5 w-3.5 shrink-0 text-status-success" />
          )}
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 truncate rounded text-left text-xs text-muted-foreground hover:text-foreground"
            aria-expanded={completedExpanded}
            onClick={() => setCompletedExpanded((value) => !value)}
          >
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                completedExpanded && 'rotate-90'
              )}
            />
            <span className="min-w-0 truncate">
              <span className="font-medium text-foreground">
                {workflowName(
                  latestCompleted,
                  t('sessions.workflowProgress.defaultName', { defaultValue: 'Workflow' })
                )}
              </span>
              <span className="mx-1.5">·</span>
              {latestCompleted.summary?.trim() || statusLabel(latestCompleted, t)}
            </span>
          </button>
          <button
            type="button"
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            aria-label={t('sessions.workflowProgress.dismiss', {
              defaultValue: 'Dismiss workflow result',
            })}
            onClick={() => setDismissedTaskId(latestCompleted.taskId)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {completedExpanded ? (
          <div className="scrollbar-pro mt-1 max-h-56 overflow-y-auto rounded-lg border border-border/40 bg-card/20 px-2">
            <SubagentTaskDetails task={latestCompleted} isVisible={isVisible} />
          </div>
        ) : null}
      </ConversationColumn>
    </div>
  );
}
