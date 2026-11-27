import { ENVIRONMENTS, type ConfigField, type EnvironmentComparisonRow } from '@flagship/shared';
import { Link } from 'react-router';
import { useState } from 'react';
import { Badge, cx, EmptyState, EnvLabel, EnvStrip, ErrorState, Fold, Loading, PageHeader, Toggle } from '../components/ui';
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
    <li>
      <Fold
        summaryClassName="px-4 py-3 flex-wrap gap-y-2"
        title={<span className="block min-w-0"><span className="block">{flag.name}</span><span className="block font-mono text-xs font-normal text-faint">{flag.key}</span></span>}
        summary={
          <span className="flex flex-wrap items-center justify-end gap-3">
            <span className="flex flex-wrap gap-1">
              {differences.length === 0
                ? <Badge tone="on">Identical</Badge>
                : differences.map((d) => <Badge key={d} tone="warn">{FIELD_LABELS[d]}</Badge>)}
            </span>
            <EnvStrip flag={flag} />
          </span>
        }
      >
        <div className="grid gap-px border-t border-line bg-line lg:grid-cols-3">
          {ENVIRONMENTS.map((env) => (
            <div key={env} className="bg-canvas/40 p-4">
              <div className="mb-2 flex items-center justify-between">
                <EnvLabel env={env} />
                <Link to={`/flags/${flag.key}?env=${env}`} className="text-xs text-accent hover:underline">Edit</Link>
              </div>
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
            </div>
          ))}
        </div>
      </Fold>
    </li>
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
        description="Which settings differ between Development, Staging and Production. Open a flag to compare its full configuration."
        actions={
          <label className="flex items-center gap-2 text-sm text-muted">
            <Toggle checked={onlyDiffs} onChange={setOnlyDiffs} label="Only show flags with differences" /> Only differences
          </label>
        }
      />
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="hidden items-center justify-between border-b border-line px-4 py-2.5 text-xs font-medium text-faint sm:flex">
          <span className="pl-5.5">Flag</span>
          <span className="flex items-center gap-3">
            <span>Differs in</span>
            <span className="grid w-60 grid-cols-3">{ENVIRONMENTS.map((env) => <span key={env} className="justify-self-center"><EnvLabel env={env} short /></span>)}</span>
          </span>
        </div>
        {visible.length === 0
          ? <EmptyState title="All environments are identical" />
          : <ul className="divide-y divide-line">{visible.map((row) => <Row key={row.flag.key} row={row} />)}</ul>}
      </div>
    </div>
  );
}
