import {
  canManageEnvironment,
  canManageGlobalConfig,
  ENVIRONMENTS,
  FLAG_TYPE_LABELS,
  type Environment,
  type FlagWithConfigs,
  type PreviewResult,
} from '@flagship/shared';
import { Archive, ArchiveRestore, ChevronLeft, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Badge, Button, cx, EmptyState, EnvLabel, ErrorState, Field, Input, Loading, Modal, Panel, StatusPill } from '../components/ui';
import { AuditEntryRow } from '../features/audit/AuditEntryRow';
import { ConfigEditor } from '../features/config-editor/ConfigEditor';
import { CurrentEvaluations, PreviewEvaluations } from '../features/config-editor/EvaluationTable';
import { useActor } from '../hooks/useActor';
import { useLiveResource } from '../hooks/useLive';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';

function EditDetailsModal({ flag, open, onClose }: { flag: FlagWithConfigs; open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ name: flag.name, description: flag.description, owner: flag.owner, tags: flag.tags.join(', ') });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.updateFlag(flag.key, { ...form, tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean) });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Edit flag details" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Description">
          <textarea
            value={form.description}
            rows={3}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded-md border border-line-strong bg-canvas px-2.5 py-2 text-sm focus:border-accent focus:outline-none"
          />
        </Field>
        <Field label="Owner"><Input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></Field>
        <Field label="Tags" hint="Comma separated"><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></Field>
        <p className="text-xs text-faint">Key and type are immutable: code and other flags reference them.</p>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

function FlagHeader({ flag }: { flag: FlagWithConfigs }) {
  const { actor } = useActor();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = actor !== null && canManageGlobalConfig(actor.role);
  const toggleArchive = async () => {
    setError(null);
    try {
      await (flag.status === 'active' ? api.archiveFlag(flag.key) : api.restoreFlag(flag.key));
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
          <p className="max-w-2xl text-sm text-muted">{flag.description}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-faint">
            <span>Owner <span className="text-fg">{flag.owner}</span></span>
            <span>Created {relativeTime(flag.createdAt)}</span>
            <span>Modified {relativeTime(flag.updatedAt)}</span>
            <span className="flex gap-1">{flag.tags.map((t) => <Badge key={t}>{t}</Badge>)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setEditing(true)}><Pencil className="size-3.5" /> Edit details</Button>
          <Button
            variant={flag.status === 'active' ? 'danger' : 'secondary'}
            disabled={!isAdmin}
            title={isAdmin ? undefined : 'Only admins can archive or restore flags'}
            onClick={toggleArchive}
          >
            {flag.status === 'active' ? <><Archive className="size-3.5" /> Archive</> : <><ArchiveRestore className="size-3.5" /> Restore</>}
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {editing && <EditDetailsModal flag={flag} open onClose={() => setEditing(false)} />}
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
    <Panel title="Current evaluation · demo users" bodyClassName="">
      {evaluations.error ? <div className="p-4"><ErrorState error={evaluations.error} onRetry={evaluations.reload} /></div>
        : !evaluations.data ? <Loading />
        : <CurrentEvaluations rows={evaluations.data} />}
    </Panel>
  );
}

function RecentChanges({ flagKey }: { flagKey: string }) {
  const audit = useLiveResource(() => api.audit({ flagKey, limit: 8 }), [flagKey]);
  return (
    <Panel title="Recent changes" bodyClassName="" actions={<Link to={`/audit?flagKey=${flagKey}`} className="text-xs text-accent hover:underline">All activity</Link>}>
      {audit.error ? <div className="p-4"><ErrorState error={audit.error} /></div>
        : !audit.data ? <Loading />
        : audit.data.length === 0 ? <EmptyState title="No changes yet" />
        : <ul className="divide-y divide-line">{audit.data.map((e) => <AuditEntryRow key={e.id} entry={e} showFlag={false} />)}</ul>}
    </Panel>
  );
}

export function FlagDetailPage() {
  const { key = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const environment = (ENVIRONMENTS.find((e) => e === params.get('env')) ?? 'development') as Environment;
  const { actor } = useActor();
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
      <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {ENVIRONMENTS.map((env) => (
          <button
            key={env}
            role="tab"
            aria-selected={env === environment}
            onClick={() => {
              setPreview(null);
              setParams({ env }, { replace: true });
            }}
            className={cx(
              '-mb-px flex items-center gap-3 border-b-2 px-3 py-2 transition-colors',
              env === environment ? 'border-accent' : 'border-transparent opacity-70 hover:opacity-100',
            )}
          >
            <EnvLabel env={env} />
            <StatusPill on={flag.environments[env].enabled && flag.status === 'active'} />
          </button>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <ConfigEditor
          key={`${flag.key}:${environment}`}
          flag={flag}
          environment={environment}
          persisted={flag.environments[environment]}
          flags={flags.data}
          segments={segments.data}
          canEdit={actor !== null && canManageEnvironment(actor.role, environment)}
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
