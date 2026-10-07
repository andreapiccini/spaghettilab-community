import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  normalizeHubUrl,
  parseHubSnapshot,
  readHubSetting,
  type HubAccount,
  type HubSnapshot,
  type HubUser,
} from "../lib/community-hub.js";

type HubContext = {
  readonly url: string;
  readonly snapshot: HubSnapshot | null;
  readonly connection: "connecting" | "online" | "offline";
  readonly error: string | null;
  readonly user: HubUser | null;
  readonly account: HubAccount | null;
  setUrl(value: string): void;
  refresh(): Promise<void>;
  request<T>(path: string, method?: string, data?: unknown): Promise<T>;
  authenticate(
    kind: "login" | "register",
    username: string,
    password: string,
    displayName?: string,
  ): Promise<void>;
  logout(): Promise<void>;
  refreshAccount(): Promise<void>;
};
const Context = createContext<HubContext | undefined>(undefined);
const cacheKey = (url: string) => `spaghettilab:hub.cache:${url}`;
const accountKey = (url: string) => `spaghettilab:hub.account:${url}`;
function cached(url: string): HubSnapshot | null {
  try {
    return parseHubSnapshot(JSON.parse(localStorage.getItem(cacheKey(url)) ?? "null"));
  } catch {
    return null;
  }
}
function savedIdentity(url: string): { user: HubUser; token: string } | null {
  try {
    return JSON.parse(localStorage.getItem(accountKey(url)) ?? "null") as {
      user: HubUser;
      token: string;
    } | null;
  } catch {
    return null;
  }
}

export function CommunityHubProvider({ children }: { readonly children: ReactNode }) {
  const [url, setBase] = useState(readHubSetting);
  const [snapshot, setSnapshot] = useState<HubSnapshot | null>(() =>
    cached(readHubSetting()),
  );
  const [connection, setConnection] = useState<HubContext["connection"]>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [identity, setIdentity] = useState(() => savedIdentity(readHubSetting()));
  const [account, setAccount] = useState<HubAccount | null>(null);
  const currentUrl = useRef(url);
  const revision = useRef(snapshot?.revision);
  const inflight = useRef<Promise<void> | null>(null);
  const request = useCallback(
    async <T,>(route: string, method = "GET", data?: unknown): Promise<T> => {
      const response = await fetch(`${url}/api/v1/${route}`, {
        method,
        headers: {
          ...(data === undefined ? {} : { "content-type": "application/json" }),
          ...(identity?.token ? { authorization: `Bearer ${identity.token}` } : {}),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
        signal: AbortSignal.timeout(12000),
      });
      const result = (await response.json()) as T & { error?: string };
      if (!response.ok) {
        if (response.status === 401 && identity && currentUrl.current === url) {
          localStorage.removeItem(accountKey(url));
          setIdentity(null);
          setAccount(null);
        }
        throw new Error(result.error ?? "Richiesta non riuscita");
      }
      return result;
    },
    [url, identity],
  );
  const refresh = useCallback(async () => {
    if (inflight.current) return inflight.current;
    const work = (async () => {
      try {
        const response = await fetch(`${url}/api/v1/sync`, {
          headers:
            revision.current === undefined
              ? {}
              : { "if-none-match": `"${revision.current}"` },
          signal: AbortSignal.timeout(8000),
        });
        if (currentUrl.current !== url) return;
        if (response.status !== 304) {
          if (!response.ok) throw new Error("Server non disponibile");
          const next = parseHubSnapshot(await response.json());
          if (currentUrl.current !== url) return;
          setSnapshot(next);
          revision.current = next.revision;
          try {
            localStorage.setItem(cacheKey(url), JSON.stringify(next));
          } catch {
            /* Cached data is optional. */
          }
        }
        setConnection("online");
        setError(null);
      } catch (cause) {
        if (currentUrl.current === url) {
          setConnection("offline");
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    })();
    inflight.current = work;
    try {
      await work;
    } finally {
      if (inflight.current === work) inflight.current = null;
    }
  }, [url]);
  useEffect(() => {
    void refresh();
    const events = new EventSource(`${url}/api/v1/events`);
    events.addEventListener("sync", () => {
      void refresh();
    });
    const timer = window.setInterval(() => {
      void refresh();
    }, 30000);
    return () => {
      events.close();
      window.clearInterval(timer);
    };
  }, [url, refresh]);
  const refreshAccount = useCallback(async () => {
    if (!identity) return;
    const next = await request<HubAccount>("account");
    if (currentUrl.current === url) setAccount(next);
  }, [identity, request, url]);
  useEffect(() => {
    if (identity) void refreshAccount().catch(() => {});
  }, [identity, refreshAccount]);
  function setUrl(value: string) {
    const next = normalizeHubUrl(value);
    localStorage.setItem("spaghettilab:hub.url", next);
    currentUrl.current = next;
    inflight.current = null;
    const nextSnapshot = cached(next);
    revision.current = nextSnapshot?.revision;
    setSnapshot(nextSnapshot);
    setIdentity(savedIdentity(next));
    setAccount(null);
    setConnection("connecting");
    setError(null);
    setBase(next);
  }
  async function authenticate(
    kind: "login" | "register",
    username: string,
    password: string,
    displayName?: string,
  ) {
    const next = await request<{ user: HubUser; token: string }>(
      `auth/${kind}`,
      "POST",
      { username, password, displayName },
    );
    if (currentUrl.current !== url) return;
    localStorage.setItem(accountKey(url), JSON.stringify(next));
    setIdentity(next);
  }
  async function logout() {
    try {
      await request("auth/logout", "POST", {});
    } finally {
      localStorage.removeItem(accountKey(url));
      setIdentity(null);
      setAccount(null);
    }
  }
  return (
    <Context.Provider
      value={{
        url,
        snapshot,
        connection,
        error,
        user: identity?.user ?? null,
        account,
        request,
        refresh,
        refreshAccount,
        setUrl,
        authenticate,
        logout,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useCommunityHub(): HubContext {
  const context = useContext(Context);
  if (!context) throw new Error("CommunityHubProvider required");
  return context;
}
