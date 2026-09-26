import { CommandStack, type ProjectId, type ProjectV1 } from "@spaghettilab/domain";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { projectRepository } from "../lib/repository.js";

export type ScreenId = string;

type SessionState = {
  readonly projectId: ProjectId;
  readonly stack: CommandStack;
};

type SessionContextValue = {
  readonly session: SessionState | null;
  readonly activeScreen: ScreenId;
  openProject(projectId: ProjectId, project: ProjectV1, options?: { readonly screen?: ScreenId }): void;
  closeProject(): void;
  /** Bumped on every `execute()`/`undo()`/`redo()` so consumers re-render — `CommandStack` itself is a plain mutable class, not React state. */
  revision: number;
  execute: CommandStack["execute"] | undefined;
  undo(): void;
  redo(): void;
  navigate(screen: ScreenId): void;
  /** Set on every execute()/undo()/redo() since the project was opened or last saved — drives the `beforeunload` warning below. */
  readonly dirty: boolean;
  markSaved(): void;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [activeScreen, setActiveScreen] = useState<ScreenId>("workspace");
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);

  const openProject = useCallback((projectId: ProjectId, project: ProjectV1, options?: { readonly screen?: ScreenId }) => {
    setSession({ projectId, stack: new CommandStack(project) });
    setActiveScreen(options?.screen ?? "core-connections");
    setRevision((r) => r + 1);
    setDirty(false);
  }, []);

  const closeProject = useCallback(() => {
    setSession(null);
    setActiveScreen("workspace");
  }, []);

  const markSaved = useCallback(() => setDirty(false), []);

  const undo = useCallback(() => {
    if (!session) return;
    session.stack.undo();
    setRevision((r) => r + 1);
    setDirty(true);
  }, [session]);

  const redo = useCallback(() => {
    if (!session) return;
    session.stack.redo();
    setRevision((r) => r + 1);
    setDirty(true);
  }, [session]);

  const execute = useMemo(() => {
    if (!session) return undefined;
    return (command: Parameters<CommandStack["execute"]>[0]) => {
      const result = session.stack.execute(command);
      setRevision((r) => r + 1);
      if (result.ok) setDirty(true);
      // Fire-and-forget persistence, same "explicit save stays separate from undo/redo" rule backend-behavior.md documents — a caller wanting a saved checkpoint calls projectRepository.save() itself, this hook does not do it implicitly.
      return result;
    };
  }, [session]);

  // A genuine external-system subscription (the browser's own unload gesture),
  // not a `setState` cascade — this is exactly what `useEffect` is for.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const navigate = useCallback((screen: ScreenId) => setActiveScreen(screen), []);

  const value: SessionContextValue = {
    session,
    activeScreen,
    openProject,
    closeProject,
    revision,
    execute,
    undo,
    redo,
    navigate,
    dirty,
    markSaved,
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession() called outside <SessionProvider>");
  return ctx;
}

/** Persists the currently open project's latest state via `ProjectRepository` — a deliberate, explicit action, never automatic (`REACT_FLOW_ARCHITECTURE.md`). */
export async function saveOpenProject(session: SessionState): Promise<void> {
  await projectRepository.save(session.stack.current);
}
