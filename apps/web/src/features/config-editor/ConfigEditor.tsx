import {
  defaultVariantKey,
  ENVIRONMENT_LABELS,
  type Environment,
  type EnvironmentConfig,
  type Flag,
  type PreviewResult,
  type Segment,
  type ValidationIssue,
} from '@flagship/shared';
import { Eye, Lock, ShieldAlert, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, Banner, Button, cx, Input, Modal, Select, Toggle } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { ConfigDiff } from './ConfigDiff';
import { RulesEditor } from './RulesEditor';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line px-4 py-4 first:border-t-0">
      <div>
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-faint">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Segmented<T extends string>({ value, options, onChange, disabled }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex rounded-md border border-line-strong bg-canvas p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cx('rounded px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed', value === o.value ? 'bg-raised text-fg shadow' : 'text-muted hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const VARIANT_COLORS = ['bg-accent', 'bg-dev', 'bg-staging', 'bg-prod', 'bg-on'];

function WeightsEditor({ flag, weights, onChange, disabled }: { flag: Flag; weights: Record<string, number>; onChange: (w: Record<string, number>) => void; disabled?: boolean }) {
  const total = flag.variants.reduce((sum, v) => sum + (weights[v.key] ?? 0), 0);
  return (
    <div className="space-y-3">
      <div className="flex h-2 overflow-hidden rounded-full bg-raised">
        {flag.variants.map((v, i) => (
          <div key={v.key} className={cx('transition-all duration-300', VARIANT_COLORS[i % VARIANT_COLORS.length])} style={{ width: `${Math.min(weights[v.key] ?? 0, 100)}%` }} />
        ))}
      </div>
      {flag.variants.map((v, i) => (
        <div key={v.key} className="flex items-center gap-3">
          <span className={cx('size-2 shrink-0 rounded-full', VARIANT_COLORS[i % VARIANT_COLORS.length])} />
          <div className="min-w-0 flex-1">
            <div className="text-sm">{v.name}{v.key === defaultVariantKey(flag) && <Badge className="ml-2">Default · served when off</Badge>}</div>
            <div className="font-mono text-[11px] text-faint">{v.key}</div>
          </div>
          <div className="relative w-24">
            <Input
              type="number" min={0} max={100} step={1} disabled={disabled} aria-label={`${v.name} weight`}
              value={weights[v.key] ?? 0}
              onChange={(e) => onChange({ ...weights, [v.key]: e.target.value === '' ? 0 : Number(e.target.value) })}
              className="pr-7 text-right"
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-faint">%</span>
          </div>
        </div>
      ))}
      <p className={cx('text-xs', total === 100 ? 'text-faint' : 'text-danger')}>
        Total {total}% {total !== 100 && '— weights must add up to 100%'}
      </p>
    </div>
  );
}

function PrerequisitesEditor({ flag, value, flags, onChange, disabled }: { flag: Flag; value: string[]; flags: Flag[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const options = flags.filter((f) => f.key !== flag.key && f.status === 'active' && !value.includes(f.key));
  return (
    <div className="space-y-2">
      {value.length === 0 && <p className="text-sm text-faint">No prerequisites.</p>}
      <div className="flex flex-wrap gap-2">
        {value.map((key) => (
          <span key={key} className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-canvas py-1 pl-2.5 pr-1 font-mono text-xs">
            {key}
            {!disabled && (
              <button type="button" onClick={() => onChange(value.filter((k) => k !== key))} className="rounded p-0.5 text-faint hover:text-danger" aria-label={`Remove ${key}`}>
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
      </div>
      {!disabled && options.length > 0 && (
        <Select className="max-w-64" value="" aria-label="Add prerequisite" onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
          <option value="">+ Add prerequisite…</option>
          {options.map((f) => <option key={f.key} value={f.key}>{f.key}</option>)}
        </Select>
      )}
    </div>
  );
}

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  return (
    <ul className="space-y-1 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
      {issues.map((issue, i) => (
        <li key={i}><span className="font-mono opacity-70">{issue.path}</span> {issue.message}</li>
      ))}
    </ul>
  );
}

export function ConfigEditor({ flag, environment, persisted, flags, segments, canEdit, onPreview }: {
  flag: Flag;
  environment: Environment;
  persisted: EnvironmentConfig;
  flags: Flag[];
  segments: Segment[];
  canEdit: boolean;
  onPreview: (result: PreviewResult | null) => void;
}) {
  // `latest` is the newest stored config this editor knows of; `base` is the one the draft started from.
  const [latest, setLatest] = useState(persisted);
  const [base, setBase] = useState(persisted);
  const [draft, setDraft] = useState(persisted);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'preview' | 'review' | null>(null);
  const [review, setReview] = useState<{ current: EnvironmentConfig; proposed: EnvironmentConfig } | null>(null);

  const dirty = !same(draft, base);
  // Saving would overwrite a change made elsewhere; the backend would refuse it (expectedConfig) anyway.
  const conflict = dirty && !same(latest, base);
  const disabled = !canEdit || flag.status === 'archived';

  // React only to new values of `persisted`. Comparing it with `base` instead would treat the list's
  // pre-save copy as a live update and revert the editor right after a save.
  const lastPersisted = useRef(persisted);
  useEffect(() => {
    if (same(persisted, lastPersisted.current)) return;
    lastPersisted.current = persisted;
    setLatest(persisted);
  }, [persisted]);

  // Follow the stored config unless the user has unsaved edits.
  useEffect(() => {
    if (!dirty && !same(latest, base)) {
      setBase(latest);
      setDraft(latest);
    }
  }, [dirty, latest, base]);

  /** Makes a config read from the backend the editor's starting point. */
  const adopt = (config: EnvironmentConfig) => {
    setLatest(config);
    setBase(config);
    setDraft(config);
  };

  const edit = (patch: Partial<EnvironmentConfig>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setIssues([]);
    setError(null);
    setNotice(null);
    onPreview(null);
  };

  const discard = () => {
    adopt(latest);
    setIssues([]);
    setError(null);
    setNotice(null);
    onPreview(null);
  };

  const handleError = (e: unknown) => {
    if (e instanceof ApiError && e.issues.length) setIssues(e.issues);
    setError(e instanceof Error ? e.message : String(e));
  };

  const fetchStored = () => api.config(flag.key, environment);

  const preview = async () => {
    setBusy('preview');
    try {
      const result = await api.previewConfig(flag.key, environment, draft);
      setIssues(result.issues);
      setError(result.valid ? null : 'Proposed configuration is invalid.');
      onPreview(result);
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(null);
    }
  };

  /** The connection dropped mid-save: ask the backend whether the write happened instead of guessing. */
  const verifyLostSave = async (expected: EnvironmentConfig) => {
    try {
      const [current, result] = await Promise.all([fetchStored(), api.previewConfig(flag.key, environment, draft)]);
      if (result.config && same(current, result.config)) {
        adopt(current);
        setNotice('The connection dropped while saving. Reloading from the server confirmed that your change was saved.');
      } else if (same(current, expected)) {
        setError('The connection dropped while saving and the change was not saved. Your edits are kept; try again.');
      } else {
        setLatest(current); // changed by someone else: shown as a conflict
      }
    } catch {
      setError('The connection dropped while saving and the API is unreachable, so it is not known whether the change was saved. Your edits are kept; check again once the API is back.');
    }
  };

  /** Saves the draft over `expected`, the stored config the user reviewed; the backend refuses if it changed. */
  const save = async (expected: EnvironmentConfig, confirmProduction = false) => {
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      await api.updateConfig(flag.key, environment, draft, expected, confirmProduction);
      // Show what the backend stored (normalized), never the local draft.
      adopt(await fetchStored());
      setIssues([]);
      onPreview(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFLICT') await fetchStored().then(setLatest, handleError);
      else if (e instanceof ApiError && e.status === 0) await verifyLostSave(expected);
      else handleError(e);
    } finally {
      setReview(null);
      setBusy(null);
    }
  };

  /** Production: review the change against the stored config, as the backend would save it. */
  const openReview = async () => {
    setBusy('review');
    setError(null);
    setNotice(null);
    try {
      const [current, result] = await Promise.all([fetchStored(), api.previewConfig(flag.key, environment, draft)]);
      setIssues(result.issues);
      if (!same(current, base)) setLatest(current);
      else if (!result.config) setError('Proposed configuration is invalid.');
      else setReview({ current, proposed: result.config });
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border border-line bg-surface">
      {!canEdit && (
        <div className="flex items-center gap-2 border-b border-line bg-raised/50 px-4 py-2 text-xs text-muted">
          <Lock className="size-3.5" /> Your role cannot change {ENVIRONMENT_LABELS[environment]}. Switch identity in the sidebar to edit.
        </div>
      )}
      {flag.status === 'archived' && (
        <div className="border-b border-line bg-raised/50 px-4 py-2 text-xs text-muted">This flag is archived. Restore it to change its configuration.</div>
      )}
      {conflict && (
        <div className="border-b border-line p-3">
          <Banner tone="warn">
            This configuration was changed elsewhere since you started editing, so your edits can't be saved over it.
            Your edits are kept below until you reload.{' '}
            <button className="font-semibold underline" onClick={discard}>Discard my edits and load the latest</button>
          </Banner>
        </div>
      )}

      <Section title="Serving" description={`Master switch for ${ENVIRONMENT_LABELS[environment]}. When off, every user gets the off result.`}>
        <div className="flex items-center gap-3">
          <Toggle checked={draft.enabled} disabled={disabled} label="Enabled" onChange={(enabled) => edit({ enabled })} />
          <span className={cx('text-sm font-medium', draft.enabled ? 'text-on' : 'text-muted')}>{draft.enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
      </Section>

      {flag.type === 'boolean' && (
        <Section title="Default rule" description="What users who match no targeting rule receive.">
          <Segmented
            value={draft.defaultEnabled ? 'on' : 'off'}
            disabled={disabled}
            options={[{ value: 'off', label: 'Serve off' }, { value: 'on', label: 'Serve on' }]}
            onChange={(v) => edit({ defaultEnabled: v === 'on' })}
          />
        </Section>
      )}

      {flag.type === 'percentage' && (
        <Section title="Percentage rollout" description="Users matching no rule are bucketed deterministically by user ID and flag key.">
          <div className="flex items-center gap-4">
            <input
              type="range" min={0} max={100} step={1} disabled={disabled} aria-label="Rollout percentage"
              value={draft.rolloutPercentage ?? 0}
              onChange={(e) => edit({ rolloutPercentage: Number(e.target.value) })}
              className="h-1.5 flex-1 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed"
            />
            <div className="relative w-24">
              <Input
                type="number" min={0} max={100} step={0.5} disabled={disabled} aria-label="Rollout percentage value"
                value={draft.rolloutPercentage ?? 0}
                onChange={(e) => edit({ rolloutPercentage: e.target.value === '' ? 0 : Number(e.target.value) })}
                className="pr-7 text-right"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-faint">%</span>
            </div>
          </div>
        </Section>
      )}

      {flag.type === 'multivariate' && (
        <Section title="Variant weights" description="Users matching no rule are assigned a variant deterministically. The default variant is served when off or excluded.">
          <WeightsEditor flag={flag} weights={draft.variantWeights ?? {}} disabled={disabled} onChange={(variantWeights) => edit({ variantWeights })} />
        </Section>
      )}

      <Section title="Targeting rules" description="Exclusions take precedence over inclusions and the rollout.">
        <RulesEditor flag={flag} rules={draft.rules} segments={segments} disabled={disabled} onChange={(rules) => edit({ rules })} />
      </Section>

      <Section title="Prerequisites" description="Flags that must be enabled for the same user in this environment.">
        <PrerequisitesEditor flag={flag} value={draft.prerequisites} flags={flags} disabled={disabled} onChange={(prerequisites) => edit({ prerequisites })} />
      </Section>

      {(error || notice || issues.length > 0) && (
        <div className="space-y-2 border-t border-line px-4 py-3">
          {notice && <p className="text-sm text-on">{notice}</p>}
          {error && <p className="text-sm text-danger">{error}</p>}
          {issues.length > 0 && <IssueList issues={issues} />}
        </div>
      )}

      {!disabled && (
        <footer className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded-b-lg border-t border-line bg-surface/95 px-4 py-3 backdrop-blur">
          <span className={cx('mr-auto text-xs', dirty ? 'text-staging' : 'text-faint')}>{dirty ? 'Unsaved changes' : 'No changes'}</span>
          <Button variant="ghost" disabled={!dirty || busy !== null} onClick={discard}>Discard</Button>
          <Button disabled={!dirty} loading={busy === 'preview'} onClick={preview}><Eye className="size-3.5" /> Preview</Button>
          <Button
            variant="primary"
            disabled={!dirty || conflict || busy !== null}
            loading={busy === 'save' || busy === 'review'}
            onClick={() => (environment === 'production' ? openReview() : save(base))}
          >
            {environment === 'production' ? 'Review & apply' : 'Save changes'}
          </Button>
        </footer>
      )}

      <Modal
        open={review !== null}
        onClose={() => setReview(null)}
        width="max-w-2xl"
        title={<span className="flex items-center gap-2"><ShieldAlert className="size-4 text-prod" /> Apply change to Production</span>}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReview(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={review !== null && same(review.current, review.proposed)}
              loading={busy === 'save'}
              onClick={() => review && save(review.current, true)}
            >
              Apply to production
            </Button>
          </>
        }
      >
        <p className="mb-4 text-sm text-muted">
          You are changing <span className="font-mono text-fg">{flag.key}</span> in the Production environment, which affects every user evaluated there. (Environments are simulated within this local demo.) Below is the stored configuration and exactly what will be saved.
        </p>
        {review && same(review.current, review.proposed) && (
          <p className="mb-4 text-sm text-staging">Once normalized by the backend, this change is identical to the stored configuration. Nothing would change.</p>
        )}
        {review && <ConfigDiff previous={review.current} next={review.proposed} />}
      </Modal>
    </div>
  );
}

