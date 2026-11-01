import type { EnvironmentConfig } from '@flagship/shared';
import { cx } from '../../components/ui';
import { configLines } from '../../lib/describe';

const isConfig = (v: unknown): v is EnvironmentConfig =>
  typeof v === 'object' && v !== null && 'enabled' in v && 'rules' in v && 'prerequisites' in v;

function Column({ title, value, changed, tone }: { title: string; value: unknown; changed: Set<string>; tone: 'old' | 'new' }) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">{title}</div>
      {value === null || value === undefined ? (
        <p className="text-sm text-faint">—</p>
      ) : isConfig(value) ? (
        <dl className="space-y-1.5">
          {configLines(value).map((line) => (
            <div
              key={line.field}
              className={cx(
                'rounded px-2 py-1 text-xs',
                changed.has(line.field) && (tone === 'old' ? 'bg-danger/10 text-danger' : 'bg-on/10 text-on'),
              )}
            >
              <dt className={cx('font-medium', !changed.has(line.field) && 'text-muted')}>{line.label}</dt>
              {line.values.map((v, i) => <dd key={i} className={cx('break-words', !changed.has(line.field) && 'text-fg/80')}>{v}</dd>)}
            </div>
          ))}
        </dl>
      ) : (
        <pre className="overflow-x-auto rounded bg-canvas p-2 font-mono text-[11px] text-muted">{JSON.stringify(value, null, 2)}</pre>
      )}
    </div>
  );
}

/** Side-by-side before/after. Environment configs are rendered field by field with changes highlighted. */
export function ConfigDiff({ previous, next }: { previous: unknown; next: unknown }) {
  const changed = new Set<string>();
  if (isConfig(previous) && isConfig(next)) {
    const before = new Map(configLines(previous).map((l) => [l.field, l.values.join('|')]));
    for (const line of configLines(next)) if (before.get(line.field) !== line.values.join('|')) changed.add(line.field);
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Column title="Before" value={previous} changed={changed} tone="old" />
      <Column title="After" value={next} changed={changed} tone="new" />
    </div>
  );
}
