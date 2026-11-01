import { ROLE_ENVIRONMENTS, ROLE_LABELS, type Role } from '@flagship/shared';
import { Flag, GitCompareArrows, History, LayoutDashboard, Menu, Store, Users, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useActor } from '../hooks/useActor';
import { cx, EnvLabel } from './ui';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/flags', label: 'Feature flags', icon: Flag },
  { to: '/environments', label: 'Environments', icon: GitCompareArrows },
  { to: '/segments', label: 'Segments', icon: Users },
  { to: '/audit', label: 'Activity', icon: History },
];

const ROLE_TONE: Record<Role, string> = {
  developer: 'text-dev',
  release_manager: 'text-staging',
  admin: 'text-prod',
};

function IdentitySwitcher() {
  const { actors, actor, setActor } = useActor();
  if (!actor) return null;
  return (
    <div className="space-y-2 rounded-lg border border-line bg-canvas/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-faint">Acting as</span>
        <span className={cx('text-[11px] font-semibold', ROLE_TONE[actor.role])}>{ROLE_LABELS[actor.role]}</span>
      </div>
      <select
        value={actor.id}
        onChange={(e) => setActor(e.target.value)}
        aria-label="Demo identity"
        className="w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
      >
        {actors.map((a) => (
          <option key={a.id} value={a.id}>{a.name} — {ROLE_LABELS[a.role]}</option>
        ))}
      </select>
      <div className="flex flex-wrap gap-x-2.5 gap-y-1">
        <span className="text-[11px] text-faint">Can edit</span>
        {ROLE_ENVIRONMENTS[actor.role].map((env) => <EnvLabel key={env} env={env} short />)}
      </div>
      <p className="text-[11px] leading-snug text-faint">Simulated identity for demo purposes. No real authentication.</p>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-center gap-2 px-1.5">
        <div className="grid size-7 place-items-center rounded-md bg-accent/15 ring-1 ring-accent/30">
          <Flag className="size-3.5 text-accent" strokeWidth={2.5} />
        </div>
        <span className="font-semibold tracking-tight">Flagship</span>
      </div>
      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) => cx(
              'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
              isActive ? 'bg-raised text-fg' : 'text-muted hover:bg-raised/60 hover:text-fg',
            )}
          >
            <Icon className="size-4" /> {label}
          </NavLink>
        ))}
        <div className="my-2 border-t border-line" />
        <NavLink to="/store" className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-raised/60 hover:text-fg">
          <Store className="size-4" /> Demo store
        </NavLink>
      </nav>
      <div className="mt-auto"><IdentitySwitcher /></div>
    </div>
  );
}

export function DashboardLayout() {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-line bg-surface/50 lg:block">
        <Sidebar />
      </aside>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-canvas/90 px-4 py-2.5 backdrop-blur lg:hidden">
        <span className="flex items-center gap-2 font-semibold"><Flag className="size-4 text-accent" /> Flagship</span>
        <button onClick={() => setOpen(true)} className="rounded p-1.5 text-muted hover:bg-raised" aria-label="Open menu"><Menu className="size-5" /></button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 animate-fade-in lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-64 border-r border-line bg-surface animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setOpen(false)} className="absolute right-3 top-3 rounded p-1.5 text-muted" aria-label="Close menu"><X className="size-4" /></button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <main className="min-w-0 px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto max-w-7xl animate-fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
