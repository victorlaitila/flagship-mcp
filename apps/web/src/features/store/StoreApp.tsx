import type { DemoUser } from '@flagship/shared';
import { LoaderCircle, WifiOff } from 'lucide-react';
import { Navigate, Route, Routes } from 'react-router';
import { useLiveResource } from '../../hooks/useLive';
import { api } from '../../lib/api';
import { CartPage } from './cart/CartPage';
import { CartProvider } from './CartContext';
import { CheckoutPage } from './checkout/CheckoutPage';
import { StoreLayout, StoreShell, StoreStatus } from './components/StoreLayout';
import { HomePage } from './pages/HomePage';
import { OrderPage } from './pages/OrderPage';
import { OrdersPage } from './pages/OrdersPage';
import { ProductPage } from './pages/ProductPage';
import { ProductsPage } from './pages/ProductsPage';
import { StoreProvider } from './StoreContext';
import { btnSecondary } from './ui';

/** The Nordhem demo storefront, mounted at /store/*. */
export function StoreApp() {
  const users = useLiveResource<DemoUser[]>(() => api.demoUsers(), []);

  if (!users.data?.length) {
    return (
      <StoreShell>
        {users.loading ? (
          <StoreStatus icon={<LoaderCircle className="size-6 animate-spin" />} title="Opening the shop…" message="Loading demo customers." />
        ) : (
          <StoreStatus icon={<WifiOff className="size-6" />} title="The shop is unavailable" message={users.error?.message ?? 'No demo customers are configured.'}>
            <button type="button" className={btnSecondary} onClick={users.reload}>
              Try again
            </button>
          </StoreStatus>
        )}
      </StoreShell>
    );
  }

  return (
    <StoreProvider users={users.data}>
      <CartProvider>
        <StoreLayout>
          <Routes>
            <Route index element={<HomePage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="products/:productId" element={<ProductPage />} />
            <Route path="cart" element={<CartPage />} />
            <Route path="checkout" element={<CheckoutPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="orders/:orderId" element={<OrderPage />} />
            <Route path="*" element={<Navigate to="/store" replace />} />
          </Routes>
        </StoreLayout>
      </CartProvider>
    </StoreProvider>
  );
}
