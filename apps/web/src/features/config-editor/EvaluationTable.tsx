import type { DemoUser, EvaluationResult, PreviewUserResult } from '@flagship/shared';
import { ArrowRight } from 'lucide-react';
import { Badge, cx } from '../../components/ui';
import { REASON_LABELS } from '../../lib/describe';

function Outcome({ result }: { result: EvaluationResult }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className={cx('size-1.5 shrink-0 rounded-full', result.enabled ? 'bg-on' : 'bg-faint')} />
        <span className={cx('text-xs font-medium', result.enabled ? 'text-on' : 'text-muted')}>
          {result.variant ?? (result.enabled ? 'On' : 'Off')}
        </span>
        <Badge className="ml-auto">{REASON_LABELS[result.reason]}</Badge>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-faint">{result.explanation}</p>
    </div>
  );
}

const UserCell = ({ user }: { user: DemoUser }) => (
  <div className="min-w-0">
    <div className="truncate text-xs font-medium text-fg">{user.name}</div>
    <div className="text-[11px] text-faint">{user.country} · {user.accountType}</div>
  </div>
);

export function CurrentEvaluations({ rows }: { rows: { user: DemoUser; result: EvaluationResult }[] }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map(({ user, result }) => (
        <li key={user.userId} className="grid grid-cols-[110px_1fr] gap-3 px-4 py-2.5">
          <UserCell user={user} />
          <Outcome result={result} />
        </li>
      ))}
    </ul>
  );
}

export function PreviewEvaluations({ results }: { results: PreviewUserResult[] }) {
  return (
    <ul className="divide-y divide-line">
      {results.map(({ user, current, proposed, changed }) => (
        <li key={user.userId} className={cx('space-y-2 px-4 py-2.5', changed && 'bg-accent/5')}>
          <div className="flex items-center justify-between">
            <UserCell user={user} />
            {changed ? <Badge tone="accent">Changes</Badge> : <span className="text-[11px] text-faint">No change</span>}
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
            <Outcome result={current} />
            <ArrowRight className="mt-0.5 size-3.5 text-faint" />
            {proposed ? <Outcome result={proposed} /> : <span className="text-xs text-faint">—</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
