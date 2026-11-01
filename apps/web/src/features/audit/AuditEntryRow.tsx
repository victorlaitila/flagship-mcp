import { canManageEnvironment, ROLE_LABELS, type AuditEntry, type AuditOperation } from '@flagship/shared';
import { ChevronRight, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, cx, EnvLabel, Modal } from '../../components/ui';
import { useActor } from '../../hooks/useActor';
import { api } from '../../lib/api';
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

function RollbackButton({ entry }: { entry: AuditEntry }) {
  const { actor } = useActor();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const env = entry.environment!;
  const allowed = actor !== null && canManageEnvironment(actor.role, env);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.rollback(entry.id, env === 'production');
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" disabled={!allowed} title={allowed ? undefined : 'Your role cannot change this environment'} onClick={() => setOpen(true)}>
        <RotateCcw className="size-3" /> Roll back
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width="max-w-2xl"
        title={`Roll back ${entry.flagKey} in ${env}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant={env === 'production' ? 'danger' : 'primary'} loading={busy} onClick={run}>
              {env === 'production' ? 'Restore in production' : 'Restore configuration'}
            </Button>
          </>
        }
      >
        <p className="mb-4 text-sm text-muted">
          Restores the configuration from before change #{entry.id} ({dateTime(entry.timestamp)}). A new audit entry is recorded; history is not modified.
        </p>
        <ConfigDiff previous={entry.next} next={entry.previous} />
        <p className="mt-3 text-xs text-faint">"Before" shows the state written by change #{entry.id}; the live config may have changed since.</p>
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
