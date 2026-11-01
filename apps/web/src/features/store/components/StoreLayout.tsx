import { Award, LoaderCircle, ShoppingBag, Truck, WifiOff } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { euro } from '../../../lib/format';
import { useCart } from '../CartContext';
import { FREE_SHIPPING_THRESHOLD } from '../pricing';
import { useFlag, useStore } from '../StoreContext';
import { btnSecondary } from '../ui';
import { ContextBar } from './ContextBar';
import { FlagInspector } from './FlagInspector';

/** Light Nordic brand shell; deliberately independent of the dark dashboard theme. */
export function StoreShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col overflow-x-clip bg-stone-50 text-stone-900 [color-scheme:light]">
      <DemoBanner />
      {children}
    </div>
  );
}

/** Always visible (sticky) and not dismissible: the store must never be mistaken for a real shop. */
function DemoBanner() {
  return (
    <div
      role="note"
      aria-label="Demo environment"
      className="sticky top-0 z-40 flex h-7 items-center justify-center whitespace-nowrap border-b border-amber-200/70 bg-amber-50 px-4 text-[11px] text-amber-950 sm:text-xs"
    >
      <span className="font-semibold tracking-wider">DEMO ENVIRONMENT</span>
      <span className="mx-1.5 text-amber-700" aria-hidden>·</span>
      <span className="sm:hidden">No real purchases or transactions.</span>
      <span className="hidden sm:inline">This is a demonstration storefront. No real purchases or transactions take place.</span>
    </div>
  );
}

export function StoreLayout({ children }: { children: ReactNode }) {
  const { evaluations, evaluationError, reloadEvaluations } = useStore();
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  return (
    <StoreShell>
      <ContextBar />
      {evaluations ? (
        <>
          <FreeShippingBanner />
          <StoreHeader />
          <main className="mx-auto w-full max-w-6xl flex-1 animate-fade-in px-4 py-8 sm:px-6 sm:py-10">{children}</main>
          <StoreFooter />
          <FlagInspector />
        </>
      ) : evaluationError ? (
        <StoreStatus icon={<WifiOff className="size-6" />} title="The shop is unavailable" message={`${evaluationError.message} Feature configuration could not be loaded.`}>
          <button type="button" className={btnSecondary} onClick={reloadEvaluations}>
            Try again
          </button>
        </StoreStatus>
      ) : (
        <StoreStatus icon={<LoaderCircle className="size-6 animate-spin" />} title="Opening the shop…" message="Evaluating feature flags for this customer." />
      )}
    </StoreShell>
  );
}

export function StoreStatus({ icon, title, message, children }: { icon: ReactNode; title: string; message: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-24 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-stone-200/70 text-stone-600">{icon}</div>
      <h1 className="font-serif text-2xl text-stone-900">{title}</h1>
      <p className="max-w-md text-sm text-stone-500">{message}</p>
      {children}
    </div>
  );
}

function FreeShippingBanner() {
  if (!useFlag('free_shipping_banner').enabled) return null;
  return (
    <div className="bg-emerald-900 px-4 py-2 text-center text-xs text-emerald-50 sm:text-sm">
      <Truck className="mr-1.5 inline size-4 align-[-3px]" aria-hidden />
      Free shipping on all orders over {euro(FREE_SHIPPING_THRESHOLD)} — delivered from our Tampere warehouse.
    </div>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm transition ${isActive ? 'text-stone-900' : 'text-stone-500 hover:text-stone-900'}`;

function StoreHeader() {
  const { user } = useStore();
  const { itemCount } = useCart();
  const loyalty = useFlag('loyalty_program');

  return (
    <header className="sticky top-7 z-30 border-b border-stone-200 bg-stone-50/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:gap-8 sm:px-6">
        <Link to="/store" className="font-serif text-2xl tracking-tight text-stone-900">
          Nordhem<span className="text-emerald-800">.</span>
        </Link>
        <nav className="flex items-center gap-4 sm:gap-6">
          <NavLink to="/store/products" className={navClass}>
            Shop
          </NavLink>
          <NavLink to="/store/orders" className={navClass}>
            Orders
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {loyalty.enabled && (
            <span className="hidden items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 sm:inline-flex" title="Nordhem Circle points">
              <Award className="size-3.5" />
              {user.loyaltyPoints.toLocaleString('en')} pts
            </span>
          )}
          <Link to="/store/cart" className="relative grid size-10 place-items-center rounded-full text-stone-800 transition hover:bg-stone-200/60" aria-label={`Cart, ${itemCount} items`}>
            <ShoppingBag className="size-5" />
            {itemCount > 0 && (
              <span className="absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-emerald-900 px-1 text-[10px] font-semibold leading-4 text-white">
                {itemCount}
              </span>
            )}
          </Link>
        </div>
      </div>
      {loyalty.enabled && (
        <div className="border-t border-stone-200 px-4 py-1.5 text-center text-xs text-amber-900 sm:hidden">
          <Award className="mr-1 inline size-3.5 align-[-2px]" /> {user.loyaltyPoints.toLocaleString('en')} Nordhem Circle points
        </div>
      )}
    </header>
  );
}

function StoreFooter() {
  return (
    <footer className="mt-16 border-t border-stone-200">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-xs text-stone-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          <span className="font-serif text-sm text-stone-800">Nordhem</span> — Nordic homeware, made slowly.
        </p>
        <p>A Flagship demo storefront. No real orders or payments are processed.</p>
      </div>
    </footer>
  );
}
