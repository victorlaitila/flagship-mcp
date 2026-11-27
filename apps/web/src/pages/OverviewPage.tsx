import { ENVIRONMENTS, type Environment, type FlagWithConfigs } from '@flagship/shared';
import { Link } from 'react-router';
import { cx, EmptyState, EnvLabel, EnvStrip, ErrorState, Loading, PageHeader, Panel } from '../components/ui';
import { AuditEntryRow } from '../features/audit/AuditEntryRow';
import { useLiveResource } from '../hooks/useLive';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';

const ENV_BAR: Record<Environment, string> = { development: 'bg-dev', staging: 'bg-staging', production: 'bg-prod' };

function EnvironmentSummary({ env, flags }: { env: Environment; flags: FlagWithConfigs[] }) {
  const enabled = flags.filter((f) => f.environments[env].enabled);
  const partial = enabled.filter((f) => {
    const c = f.environments[env];
    return (c.rolloutPercentage !== null && c.rolloutPercentage < 100) || c.rules.length > 0 || c.defaultEnabled === false;
  });
  const share = flags.length ? (enabled.length / flags.length) * 100 : 0;
  return (
    <Link to="/environments" className="block space-y-3 p-4 transition-colors hover:bg-raised/40">
      <EnvLabel env={env} />
      <div className="text-2xl font-semibold tabular-nums tracking-tight">
        {enabled.length}<span className="text-base font-normal text-faint"> of {flags.length} on</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-raised">
        <div className={cx('h-full rounded-full transition-all duration-500', ENV_BAR[env])} style={{ width: `${share}%` }} />
      </div>
      <p className="text-xs text-faint">
        {partial.length === 0 ? 'All enabled flags serve everyone' : `${partial.length} of them only for some users`}
      </p>
    </Link>
  );
}

export function OverviewPage() {
  const flags = useLiveResource(api.flags, []);
  const audit = useLiveResource(() => api.audit({ limit: 6 }), []);

  if (flags.error) return <ErrorState error={flags.error} onRetry={flags.reload} />;
  if (!flags.data) return <Loading />;
  const all = flags.data;
  const active = all.filter((f) => f.status === 'active');
  const recent = [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description={`${active.length} active flags${all.length > active.length ? `, ${all.length - active.length} archived` : ''}. Pick an environment to compare them, or a flag to change it.`}
      />
      <section className="grid divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface md:grid-cols-3 md:divide-x md:divide-y-0">
        {ENVIRONMENTS.map((env) => <EnvironmentSummary key={env} env={env} flags={active} />)}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Recently edited flags" bodyClassName="" actions={<Link to="/flags" className="text-xs text-accent hover:underline">All flags</Link>}>
          <ul className="divide-y divide-line">
            {recent.map((flag) => (
              <li key={flag.key}>
                <Link to={`/flags/${flag.key}`} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-raised/40">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium group-hover:text-accent-strong">{flag.name}</div>
                    <div className="text-xs text-faint">Edited {relativeTime(flag.updatedAt)}</div>
                  </div>
                  <div className="hidden sm:block"><EnvStrip flag={flag} /></div>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Recent changes" bodyClassName="" actions={<Link to="/audit" className="text-xs text-accent hover:underline">All activity</Link>}>
          {audit.error ? <div className="p-4"><ErrorState error={audit.error} /></div>
            : !audit.data ? <Loading />
            : audit.data.length === 0 ? <EmptyState title="No activity yet" />
            : <ul className="divide-y divide-line">{audit.data.map((e) => <AuditEntryRow key={e.id} entry={e} />)}</ul>}
        </Panel>
      </div>
    </div>
  );
}
