import type { Actor } from '@flagship/shared';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setActorId } from '../lib/api';

const STORAGE_KEY = 'flagship.actor';
const read = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

interface ActorState {
  actors: Actor[];
  actor: Actor | null;
  setActor: (id: string) => void;
}

const ActorContext = createContext<ActorState>({ actors: [], actor: null, setActor: () => {} });

/** Simulated dashboard identity. The API derives permissions from the selected actor id. */
export function ActorProvider({ children }: { children: ReactNode }) {
  const [actors, setActors] = useState<Actor[]>([]);
  const [actorId, setId] = useState<string | null>(read);

  useEffect(() => {
    api.actors().then(setActors, () => setActors([]));
  }, []);

  const actor = actors.find((a) => a.id === actorId) ?? actors.at(-1) ?? null;
  // Set synchronously during render so child effects issue requests with the right identity.
  setActorId(actor?.id ?? null);

  const setActor = (id: string) => {
    setId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* storage unavailable: selection lasts for this session only */
    }
  };

  return <ActorContext.Provider value={{ actors, actor, setActor }}>{children}</ActorContext.Provider>;
}

export const useActor = () => useContext(ActorContext);
