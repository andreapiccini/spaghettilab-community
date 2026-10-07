import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CircleDot,
  Cpu,
  FolderOpen,
  Layers,
  LoaderCircle,
  Radio,
  RefreshCw,
  Settings2,
  Sparkles,
  Trophy,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  coverUrl,
  downloadHubFile,
  saveDownload,
  type HubContest,
  type HubPackage,
  type HubPoll,
  type HubPost,
} from "../../lib/community-hub.js";
import { motionTokens } from "../../lib/motion-tokens.js";
import { publicAsset } from "../../lib/public-asset.js";
import { useCommunityHub } from "../../state/community-hub-context.js";
import { useLocale } from "../../state/locale-context.js";

const button =
  "inline-flex items-center justify-center gap-2 rounded-slpill bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-blue-dark disabled:opacity-40";
const quiet =
  "inline-flex items-center justify-center gap-2 rounded-slpill border border-border-strong bg-surface px-4 py-2.5 text-sm text-ink transition-colors hover:bg-surface-raised disabled:opacity-40";
const input =
  "mt-1 w-full rounded-slmd border border-border-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-brand-blue";
const card = "rounded-slmd border border-border bg-surface shadow-e1";

export function CommunityScreen({
  marketOnly = false,
  onOpenProjects,
}: {
  readonly marketOnly?: boolean;
  readonly onOpenProjects?: () => void;
}) {
  const hub = useCommunityHub();
  const { locale } = useLocale();
  const it = locale === "it";
  const reduced = useReducedMotion();
  const [tab, setTab] = useState<"stories" | "market" | "community">(
    marketOnly ? "market" : "stories",
  );
  const [dialog, setDialog] = useState<"server" | "account" | null>(null);
  const [post, setPost] = useState<HubPost | null>(null);
  const [contest, setContest] = useState<HubContest | null>(null);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const stories = [...(hub.snapshot?.posts ?? [])].sort(
    (a, b) =>
      Number(b.featured) - Number(a.featured) || b.createdAt.localeCompare(a.createdAt),
  );
  const featured = stories[0];
  const login = () => setDialog("account");
  const participate = (entry: HubContest) => {
    if (!hub.user) login();
    else setContest(entry);
  };
  return (
    <div className="min-h-full bg-surface-sunken font-body text-ink">
      {onOpenProjects && (
        <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-5 py-4 lg:px-10">
          <img
            src={publicAsset("ux-assets/logo-full.png")}
            alt="Spaghetti LAB"
            className="h-8"
          />
          <span className="ml-auto" />
          <button className={button} onClick={onOpenProjects}>
            <FolderOpen size={16} />
            {it ? "I miei progetti" : "My projects"}
          </button>
        </header>
      )}
      <div className="mx-auto max-w-[1450px] p-5 lg:p-9">
        <div className="mb-7 flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-[.18em] text-brand-blue">
            Spaghetti LAB · {marketOnly ? "Marketplace" : "Community"}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              className="inline-flex items-center gap-2 rounded-slpill border border-border bg-surface px-3 py-2 text-xs text-ink-muted"
              onClick={() => setDialog("server")}
            >
              <span
                className={`h-2 w-2 rounded-full ${hub.connection === "online" ? "bg-success" : hub.connection === "connecting" ? "animate-pulse bg-brand-orange" : "bg-ink-faint"}`}
              />
              {hub.connection === "online"
                ? it
                  ? "Sincronizzato"
                  : "Synced"
                : hub.connection === "connecting"
                  ? it
                    ? "Connessione…"
                    : "Connecting…"
                  : it
                    ? "Copia locale"
                    : "Offline copy"}
              <Settings2 size={12} />
            </button>
            {hub.user ? (
              <>
                <span className="text-xs text-ink-muted">{hub.user.displayName}</span>
                <button
                  className="text-xs text-brand-blue"
                  onClick={() => void hub.logout()}
                >
                  {it ? "Esci" : "Sign out"}
                </button>
              </>
            ) : (
              <button className={quiet} onClick={login}>
                <UserRound size={14} />
                {it ? "Accedi" : "Sign in"}
              </button>
            )}
          </div>
        </div>
        <div className="mb-7 flex flex-wrap items-end gap-4">
          <div className="flex-1">
            <h1 className="font-heading text-3xl font-bold tracking-tight lg:text-4xl">
              {marketOnly || tab === "market"
                ? it
                  ? "Un laboratorio in continua crescita."
                  : "A laboratory that keeps growing."
                : it
                  ? "La prossima idea parte da qui."
                  : "Your next idea starts here."}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
              {it
                ? "Progetti da cui lasciarti ispirare, nuovi moduli da esplorare e strumenti per dare forma alle tue idee."
                : "Projects to inspire you, new modules to explore, and tools to bring your ideas to life."}
            </p>
          </div>
          {!marketOnly && (
            <nav className="flex gap-1 rounded-slpill border border-border bg-surface p-1">
              {(["stories", "market", "community"] as const).map((id) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`rounded-slpill px-4 py-2 text-xs font-semibold transition-colors ${tab === id ? "bg-brand-blue text-white" : "text-ink-muted hover:text-ink"}`}
                >
                  {id === "stories"
                    ? it
                      ? "Esplora"
                      : "Explore"
                    : id === "market"
                      ? "Marketplace"
                      : "Community"}
                </button>
              ))}
            </nav>
          )}
        </div>
        {hub.connection === "offline" && (
          <p className="mb-5 rounded-slmd border border-border bg-surface px-4 py-3 text-xs text-ink-muted">
            {hub.snapshot
              ? it
                ? "Il server non è raggiungibile. Puoi continuare a consultare i contenuti sincronizzati."
                : "The server is unavailable. Your synced content remains available."
              : it
                ? "Avvia il Community Hub locale o configura l’indirizzo del tuo server."
                : "Start your local Community Hub or configure your server address."}
            <button
              className="ml-3 text-brand-blue"
              onClick={() => setDialog("server")}
            >
              {it ? "Configura" : "Configure"}
            </button>
          </p>
        )}
        {message && (
          <p
            role="status"
            className="mb-5 rounded-slmd bg-brand-blue/10 p-3 text-sm text-brand-blue"
          >
            {message}
          </p>
        )}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0 }}
            transition={motionTokens.duration.base}
          >
            {tab === "stories" && (
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div>
                  {featured ? (
                    <button
                      onClick={() => setPost(featured)}
                      className={`${card} group mb-6 block w-full overflow-hidden text-left`}
                    >
                      <div className="relative aspect-[2/1] overflow-hidden bg-brand-blue/10">
                        {coverUrl(hub.url, featured) ? (
                          <img
                            src={coverUrl(hub.url, featured)}
                            alt={featured.title}
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <Sparkles size={70} className="text-brand-blue/40" />
                          </div>
                        )}
                        <span className="absolute left-5 top-5 rounded-slpill bg-surface/95 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-brand-blue">
                          {it ? "Dal laboratorio" : "From the lab"}
                        </span>
                      </div>
                      <div className="p-6">
                        <div className="mb-3 flex gap-2">
                          {featured.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] uppercase tracking-wide text-ink-faint"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                        <h2 className="font-heading text-2xl font-bold">
                          {featured.title}
                        </h2>
                        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                          {featured.description}
                        </p>
                        <span className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-brand-blue">
                          {it ? "Scopri il progetto" : "Explore the project"}
                          <ArrowRight size={14} />
                        </span>
                      </div>
                    </button>
                  ) : (
                    <Empty
                      text={
                        it
                          ? "Le prossime storie dal laboratorio compariranno qui."
                          : "New stories from the lab will appear here."
                      }
                    />
                  )}
                  <div className="grid gap-5 md:grid-cols-2">
                    {stories.slice(1).map((story) => (
                      <button
                        key={story.id}
                        onClick={() => setPost(story)}
                        className={`${card} overflow-hidden text-left transition-transform hover:-translate-y-1`}
                      >
                        {coverUrl(hub.url, story) && (
                          <img
                            src={coverUrl(hub.url, story)}
                            alt={story.title}
                            className="aspect-[16/9] w-full object-cover"
                          />
                        )}
                        <div className="p-5">
                          <span className="text-[10px] uppercase tracking-widest text-brand-blue">
                            {story.category}
                          </span>
                          <h2 className="mt-2 font-heading text-lg font-semibold">
                            {story.title}
                          </h2>
                          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                            {story.description}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <aside className="space-y-5">
                  <div className={`${card} p-5`}>
                    <div className="flex items-center gap-2 text-brand-blue">
                      <Layers size={17} />
                      <h2 className="font-heading font-semibold">
                        {it ? "Il laboratorio si espande" : "The lab is growing"}
                      </h2>
                    </div>
                    <p className="mt-3 text-sm text-ink-muted">
                      {hub.snapshot?.modules.length ?? 0}{" "}
                      {it ? "moduli nel catalogo" : "catalog modules"} ·{" "}
                      {hub.snapshot?.packages.length ?? 0}{" "}
                      {it ? "pacchetti disponibili" : "available packages"}
                    </p>
                    <button
                      className={`${quiet} mt-4 w-full`}
                      onClick={() => setTab("market")}
                    >
                      {it ? "Apri marketplace" : "Open marketplace"}
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  {hub.snapshot?.polls.slice(0, 1).map((poll) => (
                    <PollCard
                      key={poll.id}
                      poll={poll}
                      onLogin={login}
                      onMessage={setMessage}
                    />
                  ))}
                  {hub.snapshot?.contests.slice(0, 1).map((entry) => (
                    <ContestCard
                      key={entry.id}
                      contest={entry}
                      onParticipate={() => participate(entry)}
                    />
                  ))}
                </aside>
              </div>
            )}
            {tab === "community" && (
              <div className="grid gap-6 lg:grid-cols-2">
                <section className="space-y-5">
                  <h2 className="font-heading text-xl font-bold">
                    {it ? "Progettiamo insieme" : "Let’s design together"}
                  </h2>
                  {hub.snapshot?.polls.map((poll) => (
                    <PollCard
                      key={poll.id}
                      poll={poll}
                      onLogin={login}
                      onMessage={setMessage}
                    />
                  ))}
                  {!hub.snapshot?.polls.length && (
                    <Empty
                      text={
                        it ? "Nessuna votazione pubblicata." : "No published polls."
                      }
                    />
                  )}
                </section>
                <section className="space-y-5">
                  <h2 className="font-heading text-xl font-bold">
                    {it ? "Contest e premi" : "Contests and prizes"}
                  </h2>
                  {hub.snapshot?.contests.map((entry) => (
                    <ContestCard
                      key={entry.id}
                      contest={entry}
                      onParticipate={() => participate(entry)}
                    />
                  ))}
                  {!hub.snapshot?.contests.length && (
                    <Empty
                      text={
                        it ? "Nessun contest pubblicato." : "No published contests."
                      }
                    />
                  )}
                </section>
              </div>
            )}
            {tab === "market" && (
              <>
                <div className="mb-6 flex flex-wrap items-center gap-3">
                  <input
                    className={`${input} max-w-md`}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={
                      it
                        ? "Cerca moduli, pacchetti o firmware…"
                        : "Search modules, packages or firmware…"
                    }
                  />
                  <button className={quiet} onClick={() => void hub.refresh()}>
                    <RefreshCw size={14} />
                    {it ? "Sincronizza" : "Sync"}
                  </button>
                </div>
                <h2 className="mb-4 font-heading text-xl font-bold">
                  {it ? "Moduli e catalogo NFC" : "Modules and NFC catalog"}
                </h2>
                <div className="mb-9 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {hub.snapshot?.modules
                    .filter((entry) =>
                      `${entry.title} ${entry.moduleTypeId}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                    )
                    .map((entry) => (
                      <article key={entry.id} className={`${card} p-5`}>
                        <div className="flex items-center gap-3">
                          <span className="rounded-slmd bg-brand-blue/10 p-3 text-brand-blue">
                            <Cpu size={22} />
                          </span>
                          <div>
                            <h3 className="font-heading font-semibold">
                              {entry.title}
                            </h3>
                            <span
                              className={`text-[10px] ${entry.available ? "text-success" : "text-ink-faint"}`}
                            >
                              {entry.available
                                ? it
                                  ? "Disponibile"
                                  : "Available"
                                : it
                                  ? "In arrivo"
                                  : "Coming soon"}
                            </span>
                          </div>
                        </div>
                        <p className="my-4 text-xs leading-relaxed text-ink-muted">
                          {entry.description}
                        </p>
                        <div className="flex items-center gap-2 border-t border-border pt-3 text-xs text-ink-faint">
                          <Radio size={13} />
                          <code>
                            {entry.registryId}:{entry.vendorId}:{entry.moduleTypeId}
                          </code>
                          <span className="ml-auto">
                            {entry.modes
                              ? it
                                ? "Auto-configurabile"
                                : "Auto-configurable"
                              : entry.pins
                                ? "Pinout"
                                : it
                                  ? "Pinout da completare"
                                  : "Pinout pending"}
                          </span>
                        </div>
                      </article>
                    ))}
                </div>
                <h2 className="mb-4 font-heading text-xl font-bold">
                  {it
                    ? "Download, firmware e strumenti"
                    : "Downloads, firmware and tools"}
                </h2>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {hub.snapshot?.packages
                    .filter((entry) =>
                      `${entry.title} ${entry.kind} ${entry.target}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                    )
                    .map((entry) => (
                      <PackageCard
                        key={entry.id}
                        entry={entry}
                        onMessage={setMessage}
                      />
                    ))}
                </div>
                {!hub.snapshot?.packages.length && (
                  <Empty
                    text={
                      it
                        ? "Carica il primo firmware o pacchetto dal pannello del Community Hub."
                        : "Upload your first firmware or package from the Community Hub admin panel."
                    }
                  />
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
        <footer className="mt-10 flex flex-wrap items-center gap-3 border-t border-border pt-5 text-[11px] text-ink-faint">
          <span>
            Spaghetti LAB ·{" "}
            {hub.snapshot
              ? `${it ? "Catalogo" : "Catalog"} r${hub.snapshot.revision}`
              : "Community Hub"}
          </span>
          <span className="ml-auto">
            {hub.snapshot && new Date(hub.snapshot.updatedAt).toLocaleString(locale)}
          </span>
          <button onClick={() => setDialog("server")} className="text-brand-blue">
            {it ? "Connessione server" : "Server connection"}
          </button>
        </footer>
      </div>
      {dialog === "server" && <ServerDialog onClose={() => setDialog(null)} />}
      {dialog === "account" && <AccountDialog onClose={() => setDialog(null)} />}
      {post && (
        <Dialog title={post.title} onClose={() => setPost(null)}>
          {coverUrl(hub.url, post) && (
            <img
              src={coverUrl(hub.url, post)}
              alt={post.title}
              className="mb-5 aspect-[2/1] w-full rounded-slmd object-cover"
            />
          )}
          <p className="mb-5 text-base text-ink-muted">{post.description}</p>
          <div className="space-y-4 text-sm leading-relaxed">
            {post.body.split("\n\n").map((paragraph, index) => (
              <p key={index} className="whitespace-pre-wrap">
                {paragraph}
              </p>
            ))}
          </div>
        </Dialog>
      )}
      {contest && (
        <SubmissionDialog
          contest={contest}
          onClose={() => setContest(null)}
          onMessage={setMessage}
        />
      )}
    </div>
  );
}

function Empty({ text }: { readonly text: string }) {
  return (
    <div
      className={`${card} flex flex-col items-center gap-3 p-9 text-center text-sm text-ink-muted`}
    >
      <Sparkles className="text-brand-blue/40" size={30} />
      {text}
    </div>
  );
}
function PackageCard({
  entry,
  onMessage,
}: {
  readonly entry: HubPackage;
  readonly onMessage: (message: string) => void;
}) {
  const hub = useCommunityHub();
  const { locale } = useLocale();
  const it = locale === "it";
  const [busy, setBusy] = useState(false);
  async function download() {
    if (!entry.file) return;
    setBusy(true);
    try {
      await downloadHubFile(hub.url, entry.file);
      onMessage(
        it
          ? "Download completato e integrità del file verificata."
          : "Download complete and file integrity verified.",
      );
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className={`${card} flex flex-col p-5`}>
      <div className="mb-3 flex items-center gap-2">
        <ArrowDownToLine size={20} className="text-brand-blue" />
        <span className="text-[10px] uppercase tracking-widest text-ink-muted">
          {entry.kind} · {entry.channel}
        </span>
        <span className="ml-auto rounded-slpill bg-surface-sunken px-2 py-1 text-xs">
          v{entry.version}
        </span>
      </div>
      <h3 className="font-heading text-lg font-semibold">{entry.title}</h3>
      <p className="my-3 flex-1 text-xs leading-relaxed text-ink-muted">
        {entry.description}
      </p>
      <code className="mb-4 break-all text-[10px] text-ink-faint">{entry.target}</code>
      <button
        className={button}
        disabled={!entry.file || busy || hub.connection !== "online"}
        onClick={() => void download()}
      >
        {busy ? (
          <LoaderCircle className="animate-spin" size={15} />
        ) : (
          <ArrowDownToLine size={15} />
        )}
        {it ? "Scarica" : "Download"}
        {entry.file && (
          <span className="text-[10px] opacity-70">
            {(entry.file.size / 1024).toFixed(0)} KB
          </span>
        )}
      </button>
      {entry.manifest && (
        <button
          className="mt-3 text-xs text-brand-blue"
          onClick={() =>
            saveDownload(
              new Blob([JSON.stringify(entry.manifest, null, 2)], {
                type: "application/json",
              }),
              `${entry.id}-manifest.json`,
            )
          }
        >
          {it ? "Scarica manifest" : "Download manifest"}
        </button>
      )}
      {entry.kind === "firmware" && (
        <p className="mt-3 text-[10px] leading-relaxed text-ink-faint">
          {it
            ? "La pubblicazione notifica una nuova versione. L’installazione resta una scelta sul dispositivo compatibile."
            : "Publishing announces a new version. Installation remains a choice on a compatible device."}
        </p>
      )}
    </article>
  );
}
function PollCard({
  poll,
  onLogin,
  onMessage,
}: {
  readonly poll: HubPoll;
  readonly onLogin: () => void;
  readonly onMessage: (message: string) => void;
}) {
  const hub = useCommunityHub();
  const { locale } = useLocale();
  const it = locale === "it";
  const [choice, setChoice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const voted = hub.account?.votes.find((vote) => vote.pollId === poll.id)?.option;
  const total = poll.counts.reduce((sum, count) => sum + count, 0);
  const now = useClock();
  const closed = Date.parse(poll.closesAt) <= now;
  async function vote() {
    if (!hub.user) {
      onLogin();
      return;
    }
    if (choice === null) return;
    setBusy(true);
    try {
      await hub.request(`polls/${poll.id}/vote`, "POST", { option: choice });
      await Promise.all([hub.refresh(), hub.refreshAccount()]);
      onMessage(it ? "Il tuo voto è stato registrato." : "Your vote was recorded.");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className={`${card} p-5`}>
      <div className="mb-3 flex items-center gap-2 text-brand-blue">
        <CircleDot size={17} />
        <span className="text-[10px] font-semibold uppercase tracking-wider">
          {it ? "Scegli il prossimo modulo" : "Choose the next module"}
        </span>
      </div>
      <h3 className="font-heading text-lg font-semibold">{poll.title}</h3>
      <p className="my-3 text-xs leading-relaxed text-ink-muted">{poll.description}</p>
      <div className="space-y-2">
        {poll.options.map((option, index) => (
          <button
            key={option}
            disabled={closed || busy}
            onClick={() => setChoice(index)}
            className={`relative block w-full overflow-hidden rounded-slmd border p-3 text-left text-xs ${choice === index || (choice === null && voted === index) ? "border-brand-blue" : "border-border"}`}
          >
            <span
              className="absolute inset-y-0 left-0 bg-brand-blue/5"
              style={{ width: `${total ? (poll.counts[index]! / total) * 100 : 0}%` }}
            />
            <span className="relative flex items-center gap-2">
              {option}
              {voted === index && <Check size={12} className="text-brand-blue" />}
              <span className="ml-auto text-ink-faint">{poll.counts[index]}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <span className="flex-1 text-[10px] text-ink-faint">
          {total} {it ? "voti" : "votes"} ·{" "}
          {new Date(poll.closesAt).toLocaleDateString(locale)}
        </span>
        <button
          className={button}
          disabled={
            closed ||
            busy ||
            hub.connection !== "online" ||
            (hub.user !== null && choice === null)
          }
          onClick={() => void vote()}
        >
          {busy ? (
            <LoaderCircle size={12} className="animate-spin" />
          ) : closed ? (
            it ? (
              "Chiusa"
            ) : (
              "Closed"
            )
          ) : it ? (
            "Vota"
          ) : (
            "Vote"
          )}
        </button>
      </div>
    </article>
  );
}
function ContestCard({
  contest,
  onParticipate,
}: {
  readonly contest: HubContest;
  readonly onParticipate: () => void;
}) {
  const hub = useCommunityHub();
  const { locale } = useLocale();
  const it = locale === "it";
  const entered = hub.account?.submissions.some(
    (submission) => submission.contestId === contest.id,
  );
  const now = useClock();
  const closed = Date.parse(contest.closesAt) <= now;
  return (
    <article className={`${card} overflow-hidden`}>
      <div className="bg-brand-orange/10 p-5">
        <div className="mb-3 flex items-center gap-2 text-brand-orange">
          <Trophy size={19} />
          <span className="text-[10px] font-semibold uppercase tracking-wider">
            Contest · {new Date(contest.closesAt).toLocaleDateString(locale)}
          </span>
        </div>
        <h3 className="font-heading text-xl font-bold">{contest.title}</h3>
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          {contest.description}
        </p>
      </div>
      <div className="p-5">
        <p className="text-xs font-semibold text-ink">{contest.prize}</p>
        <details className="my-3 text-xs text-ink-muted">
          <summary className="cursor-pointer">{it ? "Regolamento" : "Rules"}</summary>
          <p className="mt-2 whitespace-pre-wrap leading-relaxed">{contest.rules}</p>
        </details>
        {contest.awards.map((award) => (
          <p
            key={award.id}
            className="my-3 rounded-slmd bg-success/10 p-3 text-xs text-success"
          >
            🏆 {award.winner} · {award.projectTitle}
            <br />
            {award.prize}
          </p>
        ))}
        <div className="flex items-center gap-3">
          <span className="flex-1 text-[10px] text-ink-faint">
            {contest.submissionCount} {it ? "progetti inviati" : "entries"}
          </span>
          <button
            className={quiet}
            disabled={closed || entered || hub.connection !== "online"}
            onClick={onParticipate}
          >
            {entered
              ? it
                ? "Progetto inviato"
                : "Submitted"
              : closed
                ? it
                  ? "Concluso"
                  : "Closed"
                : it
                  ? "Partecipa"
                  : "Enter"}
            <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </article>
  );
}
function Dialog({
  title,
  children,
  onClose,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const items = ref.current?.querySelectorAll<HTMLElement>(
          "button,input,textarea,select,a[href]",
        );
        if (!items?.length) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === ref.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
      onClick={onClose}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-2xl overflow-auto rounded-slmd border border-border bg-surface p-6 shadow-e2 outline-none"
      >
        <div className="mb-5 flex items-center gap-3">
          <h2 className="flex-1 font-heading text-xl font-bold">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="text-ink-muted">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function ServerDialog({ onClose }: { readonly onClose: () => void }) {
  const hub = useCommunityHub();
  const { locale } = useLocale();
  const it = locale === "it";
  const [url, setUrl] = useState(hub.url);
  const [error, setError] = useState("");
  return (
    <Dialog
      title={it ? "Il tuo server di riferimento" : "Your community server"}
      onClose={onClose}
    >
      <p className="mb-4 text-sm leading-relaxed text-ink-muted">
        {it
          ? "Da qui arrivano moduli NFC, pacchetti, aggiornamenti e contenuti della community. In futuro puoi usare lo stesso collegamento con il server ospitato online."
          : "NFC modules, packages, updates and community content come from here. You can later use this connection with your hosted server."}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            hub.setUrl(url);
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <label className="text-xs text-ink-muted">
          URL
          <input
            type="url"
            required
            className={input}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="mt-3 text-xs text-error">
            {error}
          </p>
        )}
        <p className="mt-3 text-xs text-ink-faint">
          {hub.connection === "online"
            ? it
              ? "Server raggiungibile."
              : "Server online."
            : hub.error}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button className={button}>
            {" "}
            {it ? "Collega server" : "Connect server"}
            <ArrowRight size={14} />
          </button>
          <a
            className={quiet}
            href={`${hub.url}/admin`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {it ? "Pannello di gestione" : "Admin panel"} ↗
          </a>
        </div>
      </form>
    </Dialog>
  );
}
function AccountDialog({ onClose }: { readonly onClose: () => void }) {
  const hub = useCommunityHub();
  const { locale } = useLocale();
  const it = locale === "it";
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title={
        register
          ? it
            ? "Entra nella community"
            : "Join the community"
          : it
            ? "Bentornato nel laboratorio"
            : "Welcome back to the lab"
      }
      onClose={onClose}
    >
      <p className="mb-4 text-sm text-ink-muted">
        {it
          ? "Un account per votare i prossimi moduli e partecipare ai contest."
          : "An account to vote for upcoming modules and enter contests."}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setBusy(true);
          setError("");
          void hub
            .authenticate(
              register ? "register" : "login",
              String(data.get("username")),
              String(data.get("password")),
              String(data.get("displayName") ?? ""),
            )
            .then(onClose)
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            )
            .finally(() => setBusy(false));
        }}
        className="space-y-4"
      >
        {register && (
          <label className="block text-xs text-ink-muted">
            {it ? "Nome pubblico" : "Display name"}
            <input
              name="displayName"
              className={input}
              required
              maxLength={80}
              autoComplete="nickname"
            />
          </label>
        )}
        <label className="block text-xs text-ink-muted">
          Username
          <input
            name="username"
            className={input}
            required
            minLength={3}
            maxLength={40}
            pattern="[a-zA-Z0-9_.\-]+"
            autoComplete="username"
          />
        </label>
        <label className="block text-xs text-ink-muted">
          Password
          <input
            name="password"
            className={input}
            type="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete={register ? "new-password" : "current-password"}
          />
        </label>
        {error && (
          <p role="alert" className="text-xs text-error">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <button className={button} disabled={busy}>
            {busy && <LoaderCircle size={15} className="animate-spin" />}
            {register
              ? it
                ? "Crea account"
                : "Create account"
              : it
                ? "Accedi"
                : "Sign in"}
          </button>
          <button
            type="button"
            onClick={() => setRegister(!register)}
            className="text-xs text-brand-blue"
          >
            {register
              ? it
                ? "Ho già un account"
                : "I have an account"
              : it
                ? "Crea un account"
                : "Create an account"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function SubmissionDialog({
  contest,
  onClose,
  onMessage,
}: {
  readonly contest: HubContest;
  readonly onClose: () => void;
  readonly onMessage: (message: string) => void;
}) {
  const hub = useCommunityHub();
  const { locale } = useLocale();
  const it = locale === "it";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={contest.title} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = Object.fromEntries(new FormData(event.currentTarget));
          setBusy(true);
          void hub
            .request(`contests/${contest.id}/submissions`, "POST", data)
            .then(async () => {
              await Promise.all([hub.refresh(), hub.refreshAccount()]);
              onMessage(
                it
                  ? "Progetto inviato al contest. Buon lavoro!"
                  : "Project submitted to the contest!",
              );
              onClose();
            })
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            )
            .finally(() => setBusy(false));
        }}
      >
        <label className="block text-xs text-ink-muted">
          {it ? "Titolo del progetto" : "Project title"}
          <input className={input} name="title" required maxLength={160} />
        </label>
        <label className="block text-xs text-ink-muted">
          {it ? "Racconta la tua idea" : "Describe your idea"}
          <textarea
            className={input}
            name="description"
            required
            rows={5}
            maxLength={5000}
          />
        </label>
        <label className="block text-xs text-ink-muted">
          {it ? "Collegamento al progetto" : "Project link"}
          <input
            className={input}
            name="projectUrl"
            type="url"
            required
            placeholder="https://…"
          />
        </label>
        {error && (
          <p role="alert" className="text-xs text-error">
            {error}
          </p>
        )}
        <button className={button} disabled={busy}>
          {busy && <LoaderCircle size={15} className="animate-spin" />}
          {it ? "Invia candidatura" : "Submit entry"}
          <ArrowRight size={15} />
        </button>
      </form>
    </Dialog>
  );
}

function useClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
