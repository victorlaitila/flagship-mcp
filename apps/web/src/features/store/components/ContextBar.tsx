import { ENVIRONMENT_LABELS, ENVIRONMENTS, type Environment } from '@flagship/shared';
import { ArrowUpRight, ChevronDown, Flag, User } from 'lucide-react';
import { Link } from 'react-router';
import { useLiveStatus } from '../../../hooks/useLive';
import { useStore } from '../StoreContext';

const ENV_DOT: Record<Environment, string> = { development: 'bg-dev', staging: 'bg-staging', production: 'bg-prod' };
const regionName = new Intl.DisplayNames(['en'], { type: 'region' });
const STATUS_LABELS = {
  live: 'Live flags',
  loading: 'Evaluating…',
  reconnecting: 'Reconnecting… · last known flags',
  disconnected: 'Live updates offline · last known flags',
  stale: 'API unreachable · last known flags',
  offline: 'API unreachable',
} as const;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Demo controls: who is shopping and which environment's flag configuration the store evaluates. */
export function ContextBar() {
  const { users, user, setUserId, environment, setEnvironment, evaluations, evaluationError } = useStore();
  const live = useLiveStatus();
  // Only "live" when the flags loaded *and* the live-update connection is up; otherwise they may be outdated.
  const status = evaluationError ? (evaluations ? 'stale' : 'offline')
    : !evaluations || live === 'connecting' ? 'loading'
    : live === 'connected' ? 'live' : live;

  return (
    <div className="border-b border-stone-800 bg-stone-900 text-stone-300">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-xs sm:px-6">
        <span className="inline-flex items-center gap-1.5 font-medium text-stone-100">
          <Flag className="size-3.5 text-emerald-400" /> Flagship demo
        </span>

        <label className="relative inline-flex min-w-0 items-center" title={user.description}>
          <span className="sr-only">Demo customer</span>
          <User className="pointer-events-none absolute left-2 size-3.5 text-stone-400" />
          <select
            value={user.userId}
            onChange={(e) => setUserId(e.target.value)}
            className="max-w-[16rem] appearance-none truncate rounded-md border border-stone-700 bg-stone-800 py-1 pl-7 pr-7 text-stone-100 transition hover:border-stone-600 focus:border-emerald-500 focus:outline-none"
          >
            {users.map((u) => (
              <option key={u.userId} value={u.userId}>
                {u.name} · {regionName.of(u.country) ?? u.country} · {capitalize(u.accountType)}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 size-3.5 text-stone-400" />
        </label>

        <div role="radiogroup" aria-label="Environment" className="inline-flex rounded-md border border-stone-700 bg-stone-800 p-0.5">
          {ENVIRONMENTS.map((env) => (
            <button
              key={env}
              type="button"
              role="radio"
              aria-checked={env === environment}
              onClick={() => setEnvironment(env)}
              className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 transition ${
                env === environment ? 'bg-stone-100 font-medium text-stone-900' : 'text-stone-400 hover:text-stone-100'
              }`}
            >
              <span className={`size-1.5 rounded-full ${ENV_DOT[env]}`} />
              {ENVIRONMENT_LABELS[env]}
            </button>
          ))}
        </div>

        <span className="inline-flex items-center gap-1.5 text-stone-400">
          <span
            className={`size-1.5 rounded-full ${
              status === 'live' ? 'bg-emerald-400' : status === 'loading' ? 'animate-pulse bg-stone-400' : 'bg-amber-400'
            }`}
          />
          {STATUS_LABELS[status]}
        </span>

        <Link to="/" className="ml-auto inline-flex items-center gap-1 text-stone-400 transition hover:text-stone-100">
          Dashboard <ArrowUpRight className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}
