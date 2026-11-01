import { ENVIRONMENTS, type ConfigField, type EnvironmentComparisonRow } from '@flagship/shared';
import { Link } from 'react-router';
import { useState } from 'react';
import { Badge, cx, EmptyState, EnvLabel, ErrorState, Loading, PageHeader, Toggle } from '../components/ui';
import { useLiveResource } from '../hooks/useLive';
import { api } from '../lib/api';
import { configLines } from '../lib/describe';

const FIELD_LABELS: Record<ConfigField, string> = {
  enabled: 'Status',
  default: 'Default',
  rollout: 'Rollout',
  variants: 'Weights',
  rules: 'Rules',
  prerequisites: 'Prerequisites',
};

function Row({ row }: { row: EnvironmentComparisonRow }) {
  const { flag, differences } = row;
  const differs = new Set(differences);
  return (
    <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-[220px_repeat(3,minmax(0,1fr))]">
      <div className="bg-surface p-4">
        <Link to={`/flags/${flag.key}`} className="font-medium hover:text-accent-strong">{flag.name}</Link>
        <div className="font-mono text-[11px] text-faint">{flag.key}</div>
        <div className="mt-3 flex flex-wrap gap-1">
          {differences.length === 0
            ? <Badge tone="on">Identical</Badge>
            : differences.map((d) => <Badge key={d} tone="warn">{FIELD_LABELS[d]}</Badge>)}
        </div>
      </div>
      {ENVIRONMENTS.map((env) => (
        <Link key={env} to={`/flags/${flag.key}?env=${env}`} className="block bg-surface p-4 transition-colors hover:bg-raised/40">
          <div className="mb-2 lg:hidden"><EnvLabel env={env} /></div>
          <dl className="space-y-1.5">
            {configLines(flag.environments[env]).map((line) => (
              <div
                key={line.field}
                className={cx('grid grid-cols-[84px_1fr] gap-2 rounded px-1.5 py-0.5 text-xs', differs.has(line.field) ? 'bg-staging/10' : '')}
              >
                <dt className="text-faint">{line.label}</dt>
                <dd className={cx('min-w-0 space-y-0.5 break-words', differs.has(line.field) ? 'text-fg' : 'text-muted')}>
                  {line.field === 'enabled'
                    ? <span className={flag.environments[env].enabled ? 'font-medium text-on' : 'text-faint'}>{line.values[0]}</span>
                    : line.values.map((v, i) => <div key={i}>{v}</div>)}
                </dd>
              </div>
            ))}
          </dl>
        </Link>
      ))}
    </div>
  );
}

export function EnvironmentsPage() {
  const rows = useLiveResource(api.compare, []);
  const [onlyDiffs, setOnlyDiffs] = useState(false);
  if (rows.error) return <ErrorState error={rows.error} onRetry={rows.reload} />;
  if (!rows.data) return <Loading />;
  const active = rows.data.filter((r) => r.flag.status === 'active');
  const visible = onlyDiffs ? active.filter((r) => r.differences.length > 0) : active;

  return (
    <div>
      <PageHeader
        title="Environments"
        description="Compare each flag's configuration across Development, Staging and Production — logical environments within this local demo, not real deployments. Highlighted fields differ."
        actions={
          <label className="flex items-center gap-2 text-sm text-muted">
            <Toggle checked={onlyDiffs} onChange={setOnlyDiffs} label="Only show flags with differences" /> Only differences
          </label>
        }
      />
      <div className="mb-2 hidden gap-px px-px lg:grid lg:grid-cols-[220px_repeat(3,minmax(0,1fr))]">
        <span className="px-4 text-[11px] font-medium uppercase tracking-wider text-faint">Flag</span>
        {ENVIRONMENTS.map((env) => <span key={env} className="px-4"><EnvLabel env={env} /></span>)}
      </div>
      <div className="space-y-3">
        {visible.map((row) => <Row key={row.flag.key} row={row} />)}
        {visible.length === 0 && <EmptyState title="All environments are identical" />}
      </div>
    </div>
  );
}
