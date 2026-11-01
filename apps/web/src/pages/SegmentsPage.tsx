import { canManageGlobalConfig, type Condition, type DemoUser, type SegmentWithUsage, type ValidationIssue } from '@flagship/shared';
import { Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, EmptyState, EnvLabel, ErrorState, Field, Input, Loading, Modal, PageHeader } from '../components/ui';
import { ConditionsEditor } from '../features/config-editor/ConditionEditor';
import { useActor } from '../hooks/useActor';
import { useLiveResource } from '../hooks/useLive';
import { api, ApiError } from '../lib/api';
import { conditionText } from '../lib/describe';

function SegmentModal({ segment, onClose }: { segment: SegmentWithUsage | null; onClose: () => void }) {
  const [form, setForm] = useState({
    key: segment?.key ?? '',
    name: segment?.name ?? '',
    description: segment?.description ?? '',
    conditions: segment?.conditions ?? ([{ attribute: 'country', operator: 'equals', values: [] }] as Condition[]),
  });
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await (segment ? api.updateSegment(segment.key, form) : api.createSegment(form));
      onClose();
    } catch (e) {
      setIssues(e instanceof ApiError ? e.issues : []);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} width="max-w-2xl" title={segment ? `Edit ${segment.name}` : 'New segment'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>{segment ? 'Save segment' : 'Create segment'}</Button></>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Key" hint={segment ? 'Immutable' : 'Referenced by targeting rules'}>
            <Input className="font-mono" value={form.key} disabled={!!segment} onChange={(e) => setForm({ ...form, key: e.target.value })} />
          </Field>
        </div>
        <Field label="Description"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted">Conditions (all must match)</div>
          <ConditionsEditor conditions={form.conditions} segments={[]} allowSegment={false} onChange={(conditions) => setForm({ ...form, conditions })} />
        </div>
        {segment && segment.references.length > 0 && (
          <p className="text-xs text-staging">This segment is used by {segment.references.length} rule(s); changes apply to every environment immediately.</p>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        {issues.length > 0 && <ul className="text-xs text-danger">{issues.map((i, n) => <li key={n}><span className="font-mono opacity-70">{i.path}</span> {i.message}</li>)}</ul>}
      </div>
    </Modal>
  );
}

function DeleteSegmentModal({ segment, onClose }: { segment: SegmentWithUsage; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const referenced = segment.references.length > 0;
  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteSegment(segment.key);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Delete ${segment.name}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={referenced} loading={busy} onClick={remove}>Delete segment</Button></>}>
      {referenced ? (
        <div className="space-y-3">
          <p className="flex items-start gap-2 text-sm text-staging">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            This segment is still referenced by targeting rules. Remove it from these rules before deleting it.
          </p>
          <ul className="divide-y divide-line rounded-md border border-line">
            {segment.references.map((r) => (
              <li key={`${r.flagKey}-${r.environment}-${r.ruleId}`}>
                <Link to={`/flags/${r.flagKey}?env=${r.environment}`} className="flex items-center justify-between px-3 py-2 text-sm hover:bg-raised/40">
                  <span className="font-mono text-xs">{r.flagKey}</span>
                  <EnvLabel env={r.environment} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted">This segment is not used by any rule. Deleting it is recorded in the audit log.</p>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Modal>
  );
}

function SegmentCard({ segment, users, canEdit, onEdit, onDelete }: {
  segment: SegmentWithUsage; users: DemoUser[]; canEdit: boolean; onEdit: () => void; onDelete: () => void;
}) {
  const members = users.filter((u) => segment.matchingDemoUserIds.includes(u.userId));
  const flagsUsing = [...new Set(segment.references.map((r) => r.flagKey))];
  return (
    <article className="flex flex-col rounded-lg border border-line bg-surface">
      <header className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="min-w-0">
          <h3 className="font-medium">{segment.name}</h3>
          <div className="font-mono text-[11px] text-faint">{segment.key}</div>
          {segment.description && <p className="mt-1.5 text-sm text-muted">{segment.description}</p>}
        </div>
        <div className="flex shrink-0 gap-1">
          <button disabled={!canEdit} onClick={onEdit} title={canEdit ? 'Edit' : 'Only admins can edit segments'} className="rounded p-1.5 text-faint hover:bg-raised hover:text-fg disabled:opacity-40" aria-label="Edit segment"><Pencil className="size-3.5" /></button>
          <button disabled={!canEdit} onClick={onDelete} title={canEdit ? 'Delete' : 'Only admins can delete segments'} className="rounded p-1.5 text-faint hover:bg-raised hover:text-danger disabled:opacity-40" aria-label="Delete segment"><Trash2 className="size-3.5" /></button>
        </div>
      </header>
      <div className="space-y-3 border-t border-line px-4 py-3 text-xs">
        <div className="space-y-1">
          {segment.conditions.map((c, i) => <div key={i} className="font-mono text-muted">{i > 0 && <span className="text-faint">and </span>}{conditionText(c)}</div>)}
        </div>
        <div>
          <div className="mb-1 text-faint">{members.length} of {users.length} demo users match</div>
          <div className="flex flex-wrap gap-1">{members.map((u) => <Badge key={u.userId} tone="accent">{u.name}</Badge>)}</div>
        </div>
        <div className="text-faint">
          {flagsUsing.length === 0 ? 'Not used by any flag' : <>Used by {flagsUsing.map((k, i) => <span key={k}>{i > 0 && ', '}<Link to={`/flags/${k}`} className="font-mono text-muted hover:text-accent">{k}</Link></span>)}</>}
        </div>
      </div>
    </article>
  );
}

export function SegmentsPage() {
  const segments = useLiveResource(api.segments, []);
  const users = useLiveResource(api.demoUsers, []);
  const { actor } = useActor();
  const [editing, setEditing] = useState<SegmentWithUsage | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SegmentWithUsage | null>(null);
  const canEdit = actor !== null && canManageGlobalConfig(actor.role);

  return (
    <div>
      <PageHeader
        title="Segments"
        description="Reusable user groups for targeting rules. Segments apply to every environment, so only admins can change them."
        actions={<Button variant="primary" disabled={!canEdit} onClick={() => setEditing('new')}><Plus className="size-4" /> New segment</Button>}
      />
      {segments.error ? <ErrorState error={segments.error} onRetry={segments.reload} />
        : !segments.data || !users.data ? <Loading />
        : segments.data.length === 0 ? <EmptyState title="No segments yet" />
        : (
          <div className="grid gap-4 md:grid-cols-2">
            {segments.data.map((s) => (
              <SegmentCard key={s.key} segment={s} users={users.data!} canEdit={canEdit} onEdit={() => setEditing(s)} onDelete={() => setDeleting(s)} />
            ))}
          </div>
        )}
      {editing && <SegmentModal segment={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteSegmentModal segment={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}
