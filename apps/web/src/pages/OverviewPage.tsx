import { ENVIRONMENT_LABELS, ENVIRONMENTS, FLAG_TYPE_LABELS, FLAG_TYPES, type Environment, type FlagWithConfigs } from '@flagship/shared';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cx, EmptyState, ENV_SHORT_LABELS, EnvLabel, ErrorState, Loading, PageHeader, Panel, StatusPill } from '../components/ui';
import { AuditEntryRow } from '../features/audit/AuditEntryRow';
import { useLiveResource } from '../hooks/useLive';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';

const ENV_BAR: Record<Environment, string> = { development: 'bg-dev', staging: 'bg-staging', production: 'bg-prod' };

function Stat({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {detail && <div className="mt-1 text-[11px] text-faint">{detail}</div>}
    </div>
  );
}

function EnvironmentCard({ env, flags }: { env: Environment; flags: FlagWithConfigs[] }) {
  const enabled = flags.filter((f) => f.environments[env].enabled);
  const partial = enabled.filter((f) => {
    const c = f.environments[env];
    return (c.rolloutPercentage !== null && c.rolloutPercentage < 100) || c.rules.length > 0 || c.defaultEnabled === false;
  });
  const share = flags.length ? (enabled.length / flags.length) * 100 : 0;
  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <EnvLabel env={env} />
        <span className="text-xs text-faint">{enabled.length} / {flags.length} enabled</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-raised">
        <div className={cx('h-full rounded-full transition-all duration-500', ENV_BAR[env])} style={{ width: `${share}%` }} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          ['Fully on', enabled.length - partial.length],
          ['Targeted', partial.length],
          ['Off', flags.length - enabled.length],
        ].map(([label, n]) => (
          <div key={label} className="rounded-md bg-canvas/60 py-2">
            <div className="text-base font-semibold tabular-nums">{n}</div>
            <div className="text-[11px] text-faint">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OverviewPage() {
  const flags = useLiveResource(api.flags, []);
  const audit = useLiveResource(() => api.audit({ limit: 8 }), []);

  if (flags.error) return <ErrorState error={flags.error} onRetry={flags.reload} />;
  if (!flags.data) return <Loading />;
  const all = flags.data;
  const active = all.filter((f) => f.status === 'active');
  const prodOn = active.filter((f) => f.environments.production.enabled);
  const recent = [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description="Feature flag health across environments." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total flags" value={all.length} detail={FLAG_TYPES.map((t) => `${all.filter((f) => f.type === t).length} ${FLAG_TYPE_LABELS[t].toLowerCase()}`).join(' · ')} />
        <Stat label="Active" value={active.length} />
        <Stat label="Archived" value={all.length - active.length} />
        <Stat label="Enabled in production" value={<span>{prodOn.length}<span className="text-base text-faint"> / {active.length}</span></span>} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {ENVIRONMENTS.map((env) => <EnvironmentCard key={env} env={env} flags={active} />)}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Recent configuration changes" bodyClassName="" actions={<Link to="/audit" className="text-xs text-accent hover:underline">View all</Link>}>
          {audit.error ? <div className="p-4"><ErrorState error={audit.error} /></div>
            : !audit.data ? <Loading />
            : audit.data.length === 0 ? <EmptyState title="No activity yet" />
            : <ul className="divide-y divide-line">{audit.data.map((e) => <AuditEntryRow key={e.id} entry={e} />)}</ul>}
        </Panel>
        <Panel title="Recently modified flags" bodyClassName="">
          <ul className="divide-y divide-line">
            {recent.map((flag) => (
              <li key={flag.key}>
                <Link to={`/flags/${flag.key}`} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-raised/40">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium group-hover:text-accent-strong">{flag.name}</div>
                    <div className="font-mono text-[11px] text-faint">{flag.key} · {relativeTime(flag.updatedAt)}</div>
                  </div>
                  <div className="hidden gap-3 sm:flex">
                    {ENVIRONMENTS.map((env) => (
                      <span key={env} title={ENVIRONMENT_LABELS[env]} className="flex flex-col items-center gap-0.5">
                        <span className="text-[10px] uppercase text-faint">{ENV_SHORT_LABELS[env]}</span>
                        <StatusPill on={flag.environments[env].enabled && flag.status === 'active'} label="" />
                      </span>
                    ))}
                  </div>
                  <ArrowRight className="size-3.5 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
