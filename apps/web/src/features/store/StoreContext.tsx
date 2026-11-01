import { ENVIRONMENTS, type DemoUser, type Environment, type EvaluationResult } from '@flagship/shared';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveResource } from '../../hooks/useLive';
import { api } from '../../lib/api';
import { readStored, writeStored } from './storage';

const SESSION_KEY = 'nordhem.session';

interface StoredSession {
  userId?: string;
  environment?: string;
}

export interface StoreContextValue {
  users: DemoUser[];
  user: DemoUser;
  environment: Environment;
  setUserId: (userId: string) => void;
  setEnvironment: (environment: Environment) => void;
  /** Evaluation results for the current user and environment, keyed by flag key. Undefined until first loaded. */
  evaluations: Map<string, EvaluationResult> | undefined;
  evaluationError: Error | null;
  reloadEvaluations: () => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function useStore(): StoreContextValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside <StoreProvider>');
  return value;
}

export interface FlagValue {
  enabled: boolean;
  variant: string | null;
}

/** The evaluated value of a flag for the current customer and environment. Unknown flags are off. */
export function useFlag(key: string): FlagValue {
  const result = useStore().evaluations?.get(key);
  return { enabled: result?.enabled ?? false, variant: result?.variant ?? null };
}

/** Owns the demo customer/environment selection and the live flag evaluations for it. */
export function StoreProvider({ users, children }: { users: DemoUser[]; children: ReactNode }) {
  const [stored] = useState<StoredSession>(() => readStored<StoredSession>(SESSION_KEY, {}));
  const [userId, setUserId] = useState(stored.userId);
  const [environment, setEnvironment] = useState<Environment>(
    ENVIRONMENTS.find((e) => e === stored.environment) ?? 'production',
  );
  const user = users.find((u) => u.userId === userId) ?? users[0];

  useEffect(() => { writeStored(SESSION_KEY, { userId: user.userId, environment }); }, [user.userId, environment]);

  const evaluation = useLiveResource(() => api.evaluate(environment, user.userId), [environment, user.userId]);
  const evaluations = useMemo(
    () => (evaluation.data ? new Map(evaluation.data.map((r) => [r.flagKey, r])) : undefined),
    [evaluation.data],
  );

  const value: StoreContextValue = {
    users,
    user,
    environment,
    setUserId,
    setEnvironment,
    evaluations,
    evaluationError: evaluation.error,
    reloadEvaluations: evaluation.reload,
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
