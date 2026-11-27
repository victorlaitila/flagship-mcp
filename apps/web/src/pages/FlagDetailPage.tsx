import {
  canManageEnvironment,
  canManageGlobalConfig,
  ENVIRONMENT_LABELS,
  ENVIRONMENTS,
  FLAG_TYPE_LABELS,
  PRODUCTION_READ_ONLY_MESSAGE,
  type Environment,
  type FlagWithConfigs,
  type PreviewResult,
  type ValidationIssue,
} from '@flagship/shared';
import { Archive, ArchiveRestore, ChevronLeft, Pencil, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Badge, Button, cx, EmptyState, envDotClass, EnvLabel, ErrorState, Field, Fold, Input, Loading, Modal, Panel, StatusPill } from '../components/ui';
import { AuditEntryRow } from '../features/audit/AuditEntryRow';
import { ConfigEditor } from '../features/config-editor/ConfigEditor';
import { CurrentEvaluations, PreviewEvaluations } from '../features/config-editor/EvaluationTable';
import { useActor } from '../hooks/useActor';
import { useLiveResource } from '../hooks/useLive';
import { api, ApiError } from '../lib/api';
import { servingSummary } from '../lib/describe';
import { dateTime, relativeTime } from '../lib/format';

function EditDetailsModal({ flag, open, onClose }: { flag: FlagWithConfigs; open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ name: flag.name, description: flag.description, owner: flag.owner, tags: flag.tags.join(', ') });
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const issue = (path: string) => issues.find((i) => i.path === path || i.path.startsWith(`${path}[`))?.message;
  const submit = async () => {
    setBusy(true);
    try {
      await api.updateFlag(flag.key, { ...form, tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean) });
      onClose();
    } catch (e) {
      setIssues(e instanceof ApiError ? e.issues : []);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Edit flag details" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Name" error={issue('name')}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Description" error={issue('description')}>
          <textarea
            value={form.description}
            rows={3}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded-md border border-line-strong bg-canvas px-2.5 py-2 text-sm focus:border-accent focus:outline-none"
          />
        </Field>
        <Field label="Owner" error={issue('owner')}><Input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></Field>
        <Field label="Tags" hint="Comma separated" error={issue('tags')}><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></Field>
        <p className="text-xs text-faint">Key and type are immutable: code and other flags reference them.</p>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

function FlagHeader({ flag }: { flag: FlagWithConfigs }) {
  const { actor, productionReadOnly } = useActor();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const isAdmin = actor !== null && canManageGlobalConfig(actor.role);
  // Archiving or restoring a flag enabled in Production changes Production.
  const productionLocked = productionReadOnly && flag.environments.production.enabled;
  const archiving = flag.status === 'active';
  const toggleArchive = async (confirmProduction = false) => {
    setConfirming(false);
    setError(null);
    try {
      await (archiving ? api.archiveFlag(flag.key, confirmProduction) : api.restoreFlag(flag.key, confirmProduction));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="mb-6 space-y-3">
      <Link to="/flags" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg"><ChevronLeft className="size-3.5" /> Feature flags</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight">{flag.name}</h1>
            <Badge tone="accent">{FLAG_TYPE_LABELS[flag.type]}</Badge>
            {flag.status === 'archived' && <Badge tone="danger">Archived</Badge>}
          </div>
          <div className="font-mono text-xs text-muted">{flag.key}</div>
          {flag.description && <p className="max-w-2xl text-sm text-muted">{flag.description}</p>}
          <Fold title={<span className="text-xs font-medium text-muted">Details</span>} summaryClassName="py-1 w-fit">
            <dl className="mt-1 grid max-w-md grid-cols-[6rem_1fr] gap-x-4 gap-y-1.5 pl-5.5 text-xs">
              <dt className="text-faint">Owner</dt><dd>{flag.owner}</dd>
              <dt className="text-faint">Created</dt><dd title={dateTime(flag.createdAt)}>{relativeTime(flag.createdAt)}</dd>
              <dt className="text-faint">Edited</dt><dd title={dateTime(flag.updatedAt)}>{relativeTime(flag.updatedAt)}</dd>
              <dt className="text-faint">Tags</dt>
              <dd className="flex flex-wrap gap-1">{flag.tags.length ? flag.tags.map((t) => <Badge key={t}>{t}</Badge>) : <span className="text-faint">None</span>}</dd>
            </dl>
          </Fold>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setEditing(true)}><Pencil className="size-3.5" /> Edit details</Button>
          <Button
            variant={flag.status === 'active' ? 'danger' : 'secondary'}
            disabled={!isAdmin || productionLocked}
            title={!isAdmin ? 'Only admins can archive or restore flags' : productionLocked ? PRODUCTION_READ_ONLY_MESSAGE : undefined}
            onClick={() => (flag.environments.production.enabled ? setConfirming(true) : toggleArchive())}
          >
            {archiving ? <><Archive className="size-3.5" /> Archive</> : <><ArchiveRestore className="size-3.5" /> Restore</>}
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {editing && <EditDetailsModal flag={flag} open onClose={() => setEditing(false)} />}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={<span className="flex items-center gap-2"><ShieldAlert className="size-4 text-prod" /> {archiving ? 'Archive' : 'Restore'} a flag enabled in Production</span>}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => toggleArchive(true)}>{archiving ? 'Archive' : 'Restore'} in production</Button>
        </>}
      >
        <p className="text-sm text-muted">
          <span className="font-mono text-fg">{flag.key}</span> is enabled in Production.{' '}
          {archiving ? 'Archiving turns it off for every user there.' : 'Restoring turns it back on there with its current configuration.'}
        </p>
      </Modal>
    </div>
  );
}

function EvaluationPanel({ flag, environment, preview }: { flag: FlagWithConfigs; environment: Environment; preview: PreviewResult | null }) {
  const evaluations = useLiveResource(async () => {
    const users = await api.demoUsers();
    const results = await Promise.all(users.map((u) => api.evaluateFlag(flag.key, environment, u.userId)));
    return users.map((user, i) => ({ user, result: results[i] }));
  }, [flag.key, environment]);

  if (preview) {
    return (
      <Panel title="Preview: proposed vs current" bodyClassName="" className="ring-1 ring-accent/30">
        {!preview.valid && <p className="border-b border-line px-4 py-2 text-xs text-danger">Invalid configuration — see errors in the editor.</p>}
        <PreviewEvaluations results={preview.results} />
      </Panel>
    );
  }
  return (
    <Panel title="Demo users right now" bodyClassName="">
      {evaluations.error ? <div className="p-4"><ErrorState error={evaluations.error} onRetry={evaluations.reload} /></div>
        : !evaluations.data ? <Loading />
        : <CurrentEvaluations rows={evaluations.data} />}
    </Panel>
  );
}

function RecentChanges({ flagKey }: { flagKey: string }) {
  const audit = useLiveResource(() => api.audit({ flagKey, limit: 8 }), [flagKey]);
  return (
    <section className="rounded-lg border border-line bg-surface">
      <Fold title="Recent changes" summary={audit.data && (audit.data.length ? `Last ${relativeTime(audit.data[0].timestamp)}` : 'None yet')}>
        <div className="border-t border-line">
          {audit.error ? <div className="p-4"><ErrorState error={audit.error} /></div>
            : !audit.data ? <Loading />
            : audit.data.length === 0 ? <EmptyState title="No changes yet" />
            : <ul className="divide-y divide-line">{audit.data.map((e) => <AuditEntryRow key={e.id} entry={e} showFlag={false} />)}</ul>}
          <Link to={`/audit?flagKey=${flagKey}`} className="block border-t border-line px-4 py-2.5 text-xs text-accent hover:underline">All activity for this flag</Link>
        </div>
      </Fold>
    </section>
  );
}

export function FlagDetailPage() {
  const { key = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const environment = (ENVIRONMENTS.find((e) => e === params.get('env')) ?? 'development') as Environment;
  const { actor, productionReadOnly } = useActor();
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const flags = useLiveResource(api.flags, []);
  const segments = useLiveResource(api.segments, []);

  if (flags.error) return <ErrorState error={flags.error} onRetry={flags.reload} />;
  if (!flags.data || !segments.data) return <Loading />;
  const flag = flags.data.find((f) => f.key === key);
  if (!flag) return <EmptyState title="Flag not found" description={`No flag with key "${key}".`} />;

  return (
    <div>
      <FlagHeader flag={flag} />
      <div role="tablist" aria-label="Environment" className="mb-6 grid grid-cols-3 overflow-hidden rounded-lg border border-line bg-surface">
        {ENVIRONMENTS.map((env) => {
          const config = flag.environments[env];
          const on = config.enabled && flag.status === 'active';
          const summary = on ? servingSummary(config) : null;
          const selected = env === environment;
          return (
            <button
              key={env}
              role="tab"
              aria-selected={selected}
              onClick={() => {
                setPreview(null);
                setParams({ env }, { replace: true });
              }}
              className={cx(
                'relative flex min-w-0 flex-col items-start gap-1 border-l border-line px-3 py-3 text-left transition-colors first:border-l-0 sm:px-4',
                selected ? 'bg-raised' : 'hover:bg-raised/40',
              )}
            >
              <span className={cx('absolute inset-x-0 top-0 h-0.5', envDotClass(env), !selected && 'opacity-30')} />
              <EnvLabel env={env} />
              <StatusPill on={on} label={on ? `On${summary ? `, ${summary}` : ''}` : 'Off'} />
            </button>
          );
        })}
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <ConfigEditor
          key={`${flag.key}:${environment}`}
          flag={flag}
          environment={environment}
          persisted={flag.environments[environment]}
          flags={flags.data}
          segments={segments.data}
          lockedReason={
            actor === null || !canManageEnvironment(actor.role, environment)
              ? `Your role cannot change ${ENVIRONMENT_LABELS[environment]}. Switch identity in the sidebar to edit.`
              : environment === 'production' && productionReadOnly ? PRODUCTION_READ_ONLY_MESSAGE : null
          }
          onPreview={setPreview}
        />
        <div className="space-y-6">
          <EvaluationPanel flag={flag} environment={environment} preview={preview} />
          <RecentChanges flagKey={flag.key} />
        </div>
      </div>
    </div>
  );
}
