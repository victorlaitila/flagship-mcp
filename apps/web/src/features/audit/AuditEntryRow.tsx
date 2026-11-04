import { canManageEnvironment, ROLE_LABELS, type AuditEntry, type AuditOperation, type EnvironmentConfig, type PreviewResult } from '@flagship/shared';
import { ChevronRight, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, Banner, Button, cx, EnvLabel, Loading, Modal } from '../../components/ui';
import { useActor } from '../../hooks/useActor';
import { api, ApiError } from '../../lib/api';
import { dateTime, relativeTime } from '../../lib/format';
import { ConfigDiff } from '../config-editor/ConfigDiff';

export const OPERATION_LABELS: Record<AuditOperation, string> = {
  'flag.created': 'Flag created',
  'flag.updated': 'Details edited',
  'flag.archived': 'Flag archived',
  'flag.restored': 'Flag restored',
  'config.updated': 'Config changed',
  'config.rolled_back': 'Rolled back',
  'segment.created': 'Segment created',
  'segment.updated': 'Segment edited',
  'segment.deleted': 'Segment deleted',
};

const OPERATION_TONE: Partial<Record<AuditOperation, 'accent' | 'on' | 'danger' | 'warn'>> = {
  'config.updated': 'accent',
  'config.rolled_back': 'warn',
  'flag.created': 'on',
  'flag.archived': 'danger',
  'segment.deleted': 'danger',
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The stored config and what the rollback would store, as previewed by the backend. */
interface RollbackPlan {
  current: EnvironmentConfig;
  preview: PreviewResult;
}

function RollbackButton({ entry }: { entry: AuditEntry }) {
  const { actor } = useActor();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<RollbackPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flagKey = entry.flagKey!;
  const env = entry.environment!;
  const allowed = actor !== null && canManageEnvironment(actor.role, env);

  // Rollback restores the full previous config over whatever is stored now, so preview it against that.
  const loadPlan = async () => {
    setPlan(null);
    const [current, preview] = await Promise.all([
      api.config(flagKey, env),
      api.previewConfig(flagKey, env, entry.previous as EnvironmentConfig),
    ]);
    setPlan({ current, preview });
  };

  const show = () => {
    setOpen(true);
    setError(null);
    loadPlan().catch((e: Error) => setError(e.message));
  };

  const run = async (current: EnvironmentConfig) => {
    setBusy(true);
    setError(null);
    try {
      await api.rollback(entry.id, current, env === 'production');
      setOpen(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFLICT') {
        setError('The configuration changed while this dialog was open, so nothing was restored. The comparison below now shows the latest configuration; review it again.');
        await loadPlan().catch((err: Error) => setError(err.message));
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  const restored = plan?.preview.config ?? null;
  const noChange = plan !== null && restored !== null && same(plan.current, restored);
  const changedSince = plan !== null && !same(plan.current, entry.next);
  const affected = plan?.preview.results.filter((r) => r.changed).map((r) => r.user.name) ?? [];

  return (
    <>
      <Button size="sm" disabled={!allowed} title={allowed ? undefined : 'Your role cannot change this environment'} onClick={show}>
        <RotateCcw className="size-3" /> Roll back
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width="max-w-2xl"
        title={`Roll back ${flagKey} in ${env}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant={env === 'production' ? 'danger' : 'primary'}
              disabled={!plan || !restored || noChange}
              loading={busy}
              onClick={() => plan && run(plan.current)}
            >
              {env === 'production' ? 'Restore in production' : 'Restore configuration'}
            </Button>
          </>
        }
      >
        <p className="mb-4 text-sm text-muted">
          Restores the complete configuration from before change #{entry.id} ({dateTime(entry.timestamp)}). It replaces the
          current configuration, so any change made after #{entry.id} is undone too. A new audit entry is recorded; history is not modified.
        </p>
        {!plan ? (
          !error && <Loading />
        ) : (
          <div className="space-y-3">
            {changedSince && (
              <Banner tone="warn">This flag has changed since #{entry.id}. Those later changes are part of the comparison below and will be removed.</Banner>
            )}
            {!restored && (
              <Banner tone="danger">
                The configuration from before #{entry.id} is no longer valid, so it can't be restored:{' '}
                {plan.preview.issues.map((i) => i.message).join(' ')}
              </Banner>
            )}
            {noChange && <Banner tone="info">The current configuration already matches the one before #{entry.id}. Nothing would change.</Banner>}
            {restored && !noChange && (
              <>
                <ConfigDiff previous={plan.current} next={restored} />
                <p className="text-xs text-faint">
                  "Before" is the configuration stored now; "After" is exactly what the rollback stores.{' '}
                  {affected.length > 0 ? `Demo customers whose result changes: ${affected.join(', ')}.` : 'No demo customer\'s result changes.'}
                </p>
              </>
            )}
          </div>
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </Modal>
    </>
  );
}

export function AuditEntryRow({ entry, showFlag = true }: { entry: AuditEntry; showFlag?: boolean }) {
  const [open, setOpen] = useState(false);
  const rollbackable = entry.operation === 'config.updated' || entry.operation === 'config.rolled_back';
  return (
    <li className="group">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-raised/40">
        <ChevronRight className={cx('size-3.5 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone={OPERATION_TONE[entry.operation] ?? 'neutral'}>{OPERATION_LABELS[entry.operation]}</Badge>
            {showFlag && entry.flagKey && <span className="font-mono text-xs text-fg">{entry.flagKey}</span>}
            {entry.segmentKey && <span className="font-mono text-xs text-fg">{entry.segmentKey}</span>}
            {entry.environment && <EnvLabel env={entry.environment} />}
            {entry.rollbackOf && <span className="text-[11px] text-faint">of #{entry.rollbackOf}</span>}
          </div>
          <div className="mt-0.5 text-[11px] text-faint">
            {entry.actorName} · {ROLE_LABELS[entry.actorRole]} · <span title={dateTime(entry.timestamp)}>{relativeTime(entry.timestamp)}</span>
          </div>
        </div>
        <span className="hidden font-mono text-[11px] text-faint sm:block">#{entry.id}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line bg-canvas/40 px-4 py-4 animate-fade-in sm:pl-10">
          <ConfigDiff previous={entry.previous} next={entry.next} />
          <div className="flex items-center gap-2">
            {rollbackable && <RollbackButton entry={entry} />}
            {showFlag && entry.flagKey && entry.operation !== 'flag.archived' && (
              <Link to={`/flags/${entry.flagKey}${entry.environment ? `?env=${entry.environment}` : ''}`} className="text-xs text-accent hover:underline">Open flag →</Link>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
