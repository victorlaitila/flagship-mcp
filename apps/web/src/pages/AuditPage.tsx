import { AUDIT_OPERATIONS, ENVIRONMENT_LABELS, ENVIRONMENTS, type AuditOperation, type Environment } from '@flagship/shared';
import { useSearchParams } from 'react-router';
import { EmptyState, ErrorState, Loading, PageHeader, Select } from '../components/ui';
import { AuditEntryRow, OPERATION_LABELS } from '../features/audit/AuditEntryRow';
import { useLiveResource } from '../hooks/useLive';
import { api } from '../lib/api';

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const flagKey = params.get('flagKey') ?? '';
  const environment = (params.get('environment') ?? '') as Environment | '';
  const operation = (params.get('operation') ?? '') as AuditOperation | '';
  const flags = useLiveResource(api.flags, []);
  const entries = useLiveResource(
    () => api.audit({ flagKey: flagKey || undefined, environment: environment || undefined, operation: operation || undefined }),
    [flagKey, environment, operation],
  );
  const setFilter = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader title="Activity" description="Every configuration change, newest first. Expand an entry to compare before and after, or roll it back." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Select className="w-auto!" value={flagKey} onChange={(e) => setFilter('flagKey', e.target.value)} aria-label="Flag">
          <option value="">All flags</option>
          {flags.data?.map((f) => <option key={f.key} value={f.key}>{f.key}</option>)}
        </Select>
        <Select className="w-auto!" value={environment} onChange={(e) => setFilter('environment', e.target.value)} aria-label="Environment">
          <option value="">All environments</option>
          {ENVIRONMENTS.map((e) => <option key={e} value={e}>{ENVIRONMENT_LABELS[e]}</option>)}
        </Select>
        <Select className="w-auto!" value={operation} onChange={(e) => setFilter('operation', e.target.value)} aria-label="Operation">
          <option value="">All operations</option>
          {AUDIT_OPERATIONS.map((o) => <option key={o} value={o}>{OPERATION_LABELS[o]}</option>)}
        </Select>
      </div>
      {entries.error ? <ErrorState error={entries.error} onRetry={entries.reload} />
        : !entries.data ? <Loading />
        : (
          <div className="rounded-lg border border-line bg-surface">
            {entries.data.length === 0
              ? <EmptyState title="No matching activity" />
              : <ul className="divide-y divide-line">{entries.data.map((e) => <AuditEntryRow key={e.id} entry={e} />)}</ul>}
          </div>
        )}
    </div>
  );
}
