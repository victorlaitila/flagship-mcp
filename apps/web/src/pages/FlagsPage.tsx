import {
  ENVIRONMENT_LABELS,
  ENVIRONMENTS,
  FLAG_TYPE_LABELS,
  FLAG_TYPES,
  type Environment,
  type FlagType,
  type FlagWithConfigs,
  type ValidationIssue,
} from '@flagship/shared';
import { ListFilter, Plus, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Badge, Button, cx, EmptyState, EnvLabel, EnvStrip, ErrorState, Field, Input, Loading, Modal, PageHeader, Select } from '../components/ui';
import { useLiveResource } from '../hooks/useLive';
import { api, ApiError } from '../lib/api';
import { relativeTime } from '../lib/format';

interface Filters {
  search: string;
  environment: Environment | '';
  state: '' | 'on' | 'off';
  type: FlagType | '';
  lifecycle: '' | 'active' | 'archived';
  owner: string;
}

const EMPTY_FILTERS: Filters = { search: '', environment: '', state: '', type: '', lifecycle: 'active', owner: '' };

function matches(flag: FlagWithConfigs, f: Filters): boolean {
  const q = f.search.trim().toLowerCase();
  if (q && ![flag.key, flag.name, flag.description, ...flag.tags].some((s) => s.toLowerCase().includes(q))) return false;
  if (f.type && flag.type !== f.type) return false;
  if (f.lifecycle && flag.status !== f.lifecycle) return false;
  if (f.owner && flag.owner !== f.owner) return false;
  if (f.state) {
    const envs = f.environment ? [f.environment] : ENVIRONMENTS;
    const on = envs.some((e) => flag.environments[e].enabled);
    if ((f.state === 'on') !== on) return false;
  }
  return true;
}

function CreateFlagModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ key: '', name: '', description: '', type: 'boolean' as FlagType, owner: '', tags: '', variants: 'control, treatment' });
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const issue = (path: string) => issues.find((i) => i.path === path || i.path.startsWith(`${path}[`))?.message;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const flag = await api.createFlag({
        key: form.key, name: form.name, description: form.description, type: form.type, owner: form.owner,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        variants: form.type === 'multivariate'
          ? form.variants.split(',').map((v) => v.trim()).filter(Boolean).map((v) => ({ key: v.toLowerCase().replace(/[^a-z0-9]+/g, '_'), name: v }))
          : undefined,
      });
      navigate(`/flags/${flag.key}`);
    } catch (e) {
      setIssues(e instanceof ApiError ? e.issues : []);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create feature flag" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Create flag</Button></>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" error={issue('name')}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Gift wrapping" /></Field>
          <Field label="Key" error={issue('key')} hint="Immutable, used in code">
            <Input value={form.key} className="font-mono" onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="gift_wrapping" />
          </Field>
        </div>
        <Field label="Description" error={issue('description')}><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type" error={issue('type')}>
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as FlagType })}>
              {FLAG_TYPES.map((t) => <option key={t} value={t}>{FLAG_TYPE_LABELS[t]}</option>)}
            </Select>
          </Field>
          <Field label="Owner" error={issue('owner')}><Input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} placeholder="Checkout Team" /></Field>
        </div>
        {form.type === 'multivariate' && (
          <Field label="Variants" hint="Comma separated. The first becomes the default variant, served when the flag is off. Variants can't be changed later." error={issue('variants')}>
            <Input value={form.variants} onChange={(e) => setForm({ ...form, variants: e.target.value })} />
          </Field>
        )}
        <Field label="Tags" hint="Comma separated" error={issue('tags')}><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></Field>
        <p className="text-xs text-faint">New flags start disabled in every environment.</p>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

export function FlagsPage() {
  const flags = useLiveResource(api.flags, []);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [creating, setCreating] = useState(false);
  const owners = useMemo(() => [...new Set(flags.data?.map((f) => f.owner))].sort(), [flags.data]);
  const visible = useMemo(() => flags.data?.filter((f) => matches(f, filters)) ?? [], [flags.data, filters]);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const filtered = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);
  // Search and lifecycle stay visible; the rest is behind "Filters" and counted on the button.
  const extraFilters = [filters.environment, filters.state, filters.type, filters.owner].filter(Boolean).length;
  const [showFilters, setShowFilters] = useState(false);

  return (
    <div>
      <PageHeader
        title="Feature flags"
        description="All flags and their state in each environment."
        actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus className="size-4" /> New flag</Button>}
      />
      <div className="mb-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <Input value={filters.search} onChange={(e) => set('search', e.target.value)} placeholder="Search name, key or tag" className="pl-8" />
          </div>
          <Select className="w-auto!" value={filters.lifecycle} onChange={(e) => set('lifecycle', e.target.value as Filters['lifecycle'])} aria-label="Lifecycle">
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="">Active & archived</option>
          </Select>
          <Button variant={showFilters || extraFilters ? 'secondary' : 'ghost'} onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}>
            <ListFilter className="size-3.5" /> Filters
            {extraFilters > 0 && <span className="rounded bg-accent/15 px-1.5 text-xs font-semibold text-accent">{extraFilters}</span>}
          </Button>
          {filtered && <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}><X className="size-3.5" /> Reset</Button>}
        </div>
        {showFilters && (
          <div className="flex flex-wrap items-center gap-2 animate-fade-in">
            <Select className="w-auto!" value={filters.environment} onChange={(e) => set('environment', e.target.value as Filters['environment'])} aria-label="Environment">
              <option value="">Any environment</option>
              {ENVIRONMENTS.map((e) => <option key={e} value={e}>{ENVIRONMENT_LABELS[e]}</option>)}
            </Select>
            <Select className="w-auto!" value={filters.state} onChange={(e) => set('state', e.target.value as Filters['state'])} aria-label="Enabled state">
              <option value="">On or off</option>
              <option value="on">Enabled</option>
              <option value="off">Disabled</option>
            </Select>
            <Select className="w-auto!" value={filters.type} onChange={(e) => set('type', e.target.value as Filters['type'])} aria-label="Type">
              <option value="">All types</option>
              {FLAG_TYPES.map((t) => <option key={t} value={t}>{FLAG_TYPE_LABELS[t]}</option>)}
            </Select>
            <Select className="w-auto!" value={filters.owner} onChange={(e) => set('owner', e.target.value)} aria-label="Owner">
              <option value="">All owners</option>
              {owners.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
          </div>
        )}
      </div>

      {flags.error ? <ErrorState error={flags.error} onRetry={flags.reload} /> : !flags.data ? <Loading /> : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-faint">
                <th className="px-4 py-2.5 font-medium">Flag</th>
                <th className="px-3 py-2.5 font-medium">Owner</th>
                <th className="px-3 py-2.5 font-medium">
                  <span className="sr-only">State per environment</span>
                  <span aria-hidden className="grid w-60 grid-cols-3">
                    {ENVIRONMENTS.map((e) => (
                      <span key={e} className={cx('justify-self-center', filters.environment === e && 'text-fg')}><EnvLabel env={e} short /></span>
                    ))}
                  </span>
                </th>
                <th className="px-3 py-2.5 font-medium">Edited</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((flag) => (
                <tr key={flag.key} className="group transition-colors hover:bg-raised/40">
                  <td className="px-4 py-3 wrap-anywhere">
                    <Link to={`/flags/${flag.key}`} className="block">
                      <div className="flex items-center gap-2 font-medium text-fg group-hover:text-accent-strong">
                        {flag.name} {flag.status === 'archived' && <Badge tone="danger">Archived</Badge>}
                      </div>
                      <div className="flex flex-wrap gap-x-3 text-xs text-faint">
                        <span className="font-mono">{flag.key}</span>
                        <span>{FLAG_TYPE_LABELS[flag.type]}</span>
                      </div>
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted wrap-anywhere">{flag.owner}</td>
                  <td className="px-3 py-3"><EnvStrip flag={flag} highlight={filters.environment} /></td>
                  <td className="px-3 py-3 text-xs whitespace-nowrap text-faint">{relativeTime(flag.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && <EmptyState title="No flags match these filters" description="Try clearing a filter or the search." />}
        </div>
      )}
      {creating && <CreateFlagModal open onClose={() => setCreating(false)} />}
    </div>
  );
}
