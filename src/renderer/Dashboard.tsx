import { useEffect, useState, type ReactNode } from "react";
import { locale, tr } from "../shared/i18n";
import { DONATE_URL } from "../shared/links";
import type { AppState, DisplayInfo, Panel } from "../shared/types";
import { fmtMs, useHubState } from "./hooks";
import { ChallengesPanelBody } from "./ChallengesView";
import { ChatCommandsSettings, KeyInput } from "./ChatCommandsView";
import { DiagPanelBody } from "./DiagView";
import { SearchPanelBody } from "./SearchView";
import { SessionsPanelBody } from "./SessionsView";
import { FarmPanelBody } from "./FarmView";
import { MapsPanelBody } from "./MapsView";
import { TreePanel } from "./TreeView";
import { PricePanelBody } from "./PriceView";
import { GearPanelBody } from "./GearView";
import { Frags, StepView } from "./StepView";

const ALL_PANELS: { id: Panel; label: () => string }[] = [
  { id: "campaign", label: () => tr("Campanha", "Campaign") },
  { id: "price", label: () => tr("Preço", "Price") },
  { id: "gear", label: () => tr("Equipamento", "Equipment") },
  { id: "maps", label: () => tr("Mapas", "Maps") },
  { id: "sessions", label: () => tr("Sessões", "Sessions") },
  { id: "farm", label: () => "Farm" },
  { id: "search", label: () => tr("Buscas", "Searches") },
  { id: "build", label: () => "Build" },
  { id: "challenges", label: () => "Challenges" },
  { id: "timers", label: () => tr("Tempos", "Timers") },
  { id: "settings", label: () => tr("Configurações", "Settings") },
  { id: "diag", label: () => tr("Diagnóstico", "Diagnostics") },
];
const buildSource = (s: "manual" | "clipboard" | "saved") =>
  ({
    manual: tr("colado aqui", "pasted here"),
    clipboard: tr("pego do clipboard", "taken from the clipboard"),
    saved: tr("restaurado da última sessão", "restored from the last session"),
  })[s];
const LS_KEY = "exile-hub.visiblePanels.v9"; // bump when a panel is added so it shows up

function loadVisible(): Panel[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Panel[];
      const known = parsed.filter((p) => ALL_PANELS.some((a) => a.id === p));
      if (known.length) return known;
    }
  } catch {
    /* storage unavailable */
  }
  return ALL_PANELS.map((p) => p.id);
}

/**
 * Who is playing. The log names a character only when it levels up or dies, so after a switch the
 * player can pick it here; the next level-up/death confirms or corrects it on its own.
 */
function CharacterPicker({ state }: { state: AppState }) {
  const list = state.knownCharacters;
  const current = state.characterName;
  if (!list.length) return <span>{current ?? tr("personagem ?", "character ?")}</span>;
  return (
    <select
      className={`char-pick${current ? "" : " unknown"}`}
      value={current ?? ""}
      title={tr("O jogo só informa o personagem quando ele sobe de nível ou morre: escolha aqui se o app não souber", "The game only names the character when it levels up or dies: pick it here if the app does not know")}
      onChange={(e) => e.target.value && void window.hub.setCharacter(e.target.value)}
    >
      {!current && <option value="">{tr("quem está jogando?", "who is playing?")}</option>}
      {current && !list.some((c) => c.name === current) && <option value={current}>{current}</option>}
      {list.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name} ({c.className} {c.level})
        </option>
      ))}
    </select>
  );
}

function PanelBox({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`panel${className ? ` ${className}` : ""}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function CampaignPanel({ state }: { state: AppState }) {
  const t = state.tracker;
  const pct = t.total ? Math.round((t.cursor / t.total) * 100) : 0;
  if (state.endgame) {
    return (
      <PanelBox title={tr("Campanha", "Campaign")}>
        <div className="muted">
          {tr(
            `Você está no endgame (${state.areaName ?? "mapa"}): a rota da campanha fica pausada e o overlay mostra os mapas. Ela volta sozinha quando você entrar numa zona da campanha.`,
            `You are in the endgame (${state.areaName ?? "map"}): the campaign route is paused and the overlay shows your maps. It comes back on its own when you enter a campaign zone.`,
          )}
        </div>
      </PanelBox>
    );
  }
  // after a restart the log may not say who is playing: an endgame player in their hideout would
  // otherwise see "Act 1, find and kill Hillock" (a new character still starts in act 1 zones)
  if (!state.characterName && state.knownCharacters.length > 0 && t.cursor === 0 && state.areaId && !/^1_1_/.test(state.areaId)) {
    return (
      <PanelBox title={tr("Campanha", "Campaign")}>
        <div className="muted">
          {tr(
            'Ainda não sei qual personagem você está jogando: o jogo só informa quando ele sobe de nível ou morre. Escolha no topo, em "quem está jogando?", para ver a rota e os tempos dele.',
            'I do not know which character you are playing yet: the game only says when it levels up or dies. Pick it at the top, in "who is playing?", to see its route and timers.',
          )}
        </div>
      </PanelBox>
    );
  }
  return (
    <PanelBox title={`${tr("Campanha — Ato", "Campaign — Act")} ${t.act || "–"}`}>
      <div className="row">
        <div className="bar">
          <div className="bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="muted">
          {t.cursor}/{t.total} ({pct}%)
        </span>
      </div>
      {t.offRoute && (
        <div className="warn">
          {tr("Você está numa zona que a rota não esperava", "You are in a zone the route did not expect")} ({state.areaName ?? "?"}).{" "}
          <button onClick={() => void window.hub.routeSync()}>{tr("Sincronizar com a zona atual", "Sync with the current zone")}</button>
        </div>
      )}
      {t.done ? (
        <p>{tr("Rota concluída.", "Route complete.")}</p>
      ) : (
        <ul className="steps">
          {t.block.map((s) => (
            <StepView key={s.id} step={s} />
          ))}
        </ul>
      )}
      {t.next && (
        <div className="next">
          {tr("Próximo:", "Next:")} <Frags fragments={t.next.fragments} />
        </div>
      )}
      <div className="row buttons">
        <button onClick={() => void window.hub.routePrev()}>◀ {tr("Zona anterior", "Previous zone")}</button>
        <button onClick={() => void window.hub.routeNext()}>{tr("Próxima zona", "Next zone")} ▶</button>
        <button onClick={() => void window.hub.routeSync()}>{tr("Sincronizar", "Sync")}</button>
        <button className="danger" onClick={() => void window.hub.routeReset()}>
          {tr("Reiniciar run", "Restart run")}
        </button>
      </div>
    </PanelBox>
  );
}

function PricePanel({ state }: { state: AppState }) {
  return (
    <PanelBox title={tr("Preço (price check)", "Price check")} className="panel-tall">
      {!state.config.priceCheckEnabled && (
        <div className="warn">{tr("Price check desligado nas configurações.", "Price check is off in the settings.")}</div>
      )}
      {state.config.priceCheckEnabled && !state.league && <div className="warn">{tr("Carregando ligas…", "Loading leagues…")}</div>}
      <PricePanelBody p={state.price} recent={state.priceRecent} />
    </PanelBox>
  );
}

function GearPanel({ state }: { state: AppState }) {
  return (
    <PanelBox title={tr("Equipamento", "Equipment")} className="panel-tall">
      <GearPanelBody state={state} />
    </PanelBox>
  );
}

function UpdateBadge({ u }: { u: AppState["update"] }) {
  const text: Record<AppState["update"]["status"], string> = {
    disabled: u.message ?? tr("atualização automática desligada", "automatic updates off"),
    checking: tr("procurando atualização…", "checking for updates…"),
    latest: tr("atualizado", "up to date"),
    downloading: `${tr("baixando", "downloading")} ${u.version ?? ""}${u.progress !== null ? ` (${u.progress}%)` : ""}…`,
    ready: tr(`versão ${u.version} pronta: instala ao fechar o app`, `version ${u.version} ready: installs when you quit the app`),
    error: `${tr("não foi possível verificar atualizações", "could not check for updates")}${u.message ? ` (${u.message})` : ""}`,
  };
  return (
    <span className="update-badge">
      v{u.current} · {text[u.status]}
      {u.status === "ready" && (
        <button className="primary small-btn" onClick={() => void window.hub.installUpdate()}>
          {tr("Reiniciar e atualizar", "Restart and update")}
        </button>
      )}
      {" · "}
    </span>
  );
}

function SessionsPanel({ state }: { state: AppState }) {
  return (
    <PanelBox title={tr("Sessões de jogo", "Play sessions")}>
      <SessionsPanelBody state={state} />
    </PanelBox>
  );
}

function SearchPanel({ state }: { state: AppState }) {
  return (
    <PanelBox title={tr("Buscas (cole no baú/vendedor)", "Searches (paste in stash/vendor)")} className="panel-tall">
      <SearchPanelBody state={state} />
    </PanelBox>
  );
}

function DiagPanel({ state }: { state: AppState }) {
  return (
    <PanelBox title={tr("Diagnóstico", "Diagnostics")} className="panel-tall">
      <DiagPanelBody state={state} />
    </PanelBox>
  );
}

function MapsPanel({ state }: { state: AppState }) {
  return (
    <PanelBox title={tr("Mapas", "Maps")} className="panel-tall">
      <MapsPanelBody maps={state.maps} />
    </PanelBox>
  );
}

function FarmPanel({ state }: { state: AppState }) {
  return (
    <PanelBox title={tr("Farm de bosses — valor esperado", "Boss farming — expected value")} className="panel-tall panel-wide">
      <FarmPanelBody runs={state.farmRuns} maps={state.maps.byMap} pricesVersion={state.farmPricesVersion} />
    </PanelBox>
  );
}

function BuildPanel({ state }: { state: AppState }) {
  const [input, setInput] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lvl = state.characterLevel;
  const b = state.build;

  const doImport = async () => {
    setBusy(true);
    setMsg(null);
    const res = await window.hub.importPob(input);
    setBusy(false);
    setMsg(res.ok ? tr("Importado.", "Imported.") : `${tr("Falha ao importar", "Import failed")}: ${res.error ?? tr("erro desconhecido", "unknown error")}`);
    if (res.ok) setInput("");
  };

  return (
    <PanelBox title="Build (Path of Building)" className="panel-tall">
      <div className="muted small">
        {state.buildInfo
          ? `Build ${buildSource(state.buildInfo.source)} · ${new Date(state.buildInfo.at).toLocaleString(locale())}`
          : tr("Copie o código ou o link (pobb.in / pastebin) no Path of Building: o app importa sozinho.", "Copy the code or the link (pobb.in / pastebin) in Path of Building: the app imports it on its own.")}
      </div>
      <textarea
        placeholder={tr("Cole um código do PoB ou um link do pastebin.com / pobb.in", "Paste a PoB code or a pastebin.com / pobb.in link")}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={3}
      />
      <div className="row">
        <button disabled={busy || !input.trim()} onClick={() => void doImport()}>
          {busy ? tr("Importando…", "Importing…") : tr("Importar", "Import")}
        </button>
        {msg && <span className={msg.startsWith(tr("Falha ao importar", "Import failed")) ? "warn-text" : "muted"}>{msg}</span>}
      </div>
      {state.tree && <TreePanel tree={state.tree} />}
      {b && (
        <>
          <h3>{tr("Gemas", "Gems")}</h3>
          <p className="muted">
            {b.className}
            {b.ascendClass ? ` / ${b.ascendClass}` : ""} · {tr("build nível", "build level")} {b.level} · {b.treeNodes.length} {tr("passivos", "passives")}
            {lvl !== null ? tr(` · você está no nível ${lvl}`, ` · you are level ${lvl}`) : ""}
          </p>
          {b.groups.map((g, i) => (
            <div className={`gem-group${g.enabled ? "" : " disabled"}`} key={i}>
              <div className="gem-title">
                {g.label}
                {g.slot ? <span className="muted"> · {g.slot}</span> : null}
              </div>
              <div className="gems">
                {g.gems.map((gem, j) => {
                  const ready = gem.requiredLevel !== null && lvl !== null && gem.requiredLevel <= lvl;
                  return (
                    <span
                      key={j}
                      className={`gem ${gem.support ? "support" : "active"}${ready ? " ready" : ""}${gem.enabled ? "" : " off"}`}
                      title={gem.requiredLevel !== null ? `${tr("requer nível", "requires level")} ${gem.requiredLevel}` : tr("nível desconhecido", "unknown level")}
                    >
                      {gem.name}
                      {gem.requiredLevel !== null ? ` · ${gem.requiredLevel}` : ""}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </PanelBox>
  );
}

function TimersPanel({ state }: { state: AppState }) {
  // act timers only mean something in the campaign
  if (state.endgame) return null;
  const t = state.timers;
  const acts = Object.keys(t.splits)
    .map(Number)
    .sort((a, b) => a - b);
  return (
    <PanelBox title={tr("Tempos", "Timers")}>
      <div className="big">{fmtMs(t.runMs)}</div>
      <div className="muted">{tr("tempo total", "total time")}{t.act ? ` · ${tr("Ato", "Act")} ${t.act}: ${fmtMs(t.actMs)}` : ""}</div>
      <table className="splits">
        <tbody>
          {acts.map((a) => (
            <tr key={a}>
              <td>{tr("Ato", "Act")} {a}</td>
              <td>{fmtMs(a === t.act ? t.actMs : t.splits[a])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PanelBox>
  );
}

function SettingsPanel({ state }: { state: AppState }) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [displayId, setDisplayId] = useState<number | null>(state.config.dashboardDisplayId);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);

  useEffect(() => {
    void window.hub.listDisplays().then(setDisplays);
  }, []);

  const statusText: Record<AppState["logStatus"], string> = {
    "no-path": tr("nenhum Client.txt selecionado", "no Client.txt selected"),
    waiting: tr("aguardando o arquivo aparecer", "waiting for the file to appear"),
    watching: tr("acompanhando o Client.txt", "following Client.txt"),
    error: `${tr("erro", "error")}: ${state.logError ?? tr("desconhecido", "unknown")}`,
  };

  return (
    <PanelBox title={tr("Configurações", "Settings")}>
      <h3>{tr("Idioma", "Language")}</h3>
      <LanguageSelect value={state.config.language} />

      <h3>Client.txt</h3>
      <div className="path">{state.config.clientLogPath ?? "—"}</div>
      <div className="muted">{statusText[state.logStatus]}</div>
      <div className="row buttons">
        <button onClick={() => void window.hub.pickLog()}>{tr("Escolher arquivo…", "Choose file…")}</button>
        <button
          onClick={async () => {
            const p = await window.hub.detectLog();
            setDetectMsg(p ? `${tr("encontrado", "found")}: ${p}` : tr("não encontrado nos lugares de costume, escolha manualmente", "not found in the usual places, pick it by hand"));
          }}
        >
          {tr("Detectar automaticamente", "Detect automatically")}
        </button>
      </div>
      {detectMsg && <div className="muted">{detectMsg}</div>}

      <h3>{tr("Rota da campanha", "Campaign route")}</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={state.config.leagueStart}
          onChange={(e) => void window.hub.setConfig({ leagueStart: e.target.checked })}
        />
        {tr("Rota de início de liga (passos extras: waypoints antecipados, trials do Lab, equipamento inicial)", "League start route (extra steps: early waypoints, Lab trials, starting gear)")}
      </label>

      <h3>Price check</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={state.config.priceCheckEnabled}
          onChange={(e) => void window.hub.setConfig({ priceCheckEnabled: e.target.checked })}
        />
        {tr("Price check de itens no jogo (Ctrl+D sobre o item)", "Price check items in game (Ctrl+D over the item)")}
      </label>
      {state.chat.supported && state.config.priceCheckEnabled && (
        <div className="row">
          <span className="muted">{tr("Tecla do price check", "Price check key")}</span>
          <KeyInput value={state.config.priceCheckKey ?? ""} onChange={(k) => void window.hub.setConfig({ priceCheckKey: k })} />
          {state.config.priceCheckKey && (
            <button className="small" onClick={() => void window.hub.setConfig({ priceCheckKey: null })}>
              {tr("desligar", "turn off")}
            </button>
          )}
          <span className="muted small">
            {tr("com o mouse sobre o item: o app copia (Ctrl+Alt+C, com os tiers) e abre o preço ao lado; Esc fecha", "with the mouse over the item: the app copies it (Ctrl+Alt+C, with tiers) and opens the price next to it; Esc closes")}
          </span>
        </div>
      )}
      <div className="row">
        <span className="muted">{tr("Liga", "League")}</span>
        <select
          value={state.config.league ?? ""}
          onChange={(e) => void window.hub.setConfig({ league: e.target.value === "" ? null : e.target.value })}
        >
          <option value="">{tr("automática", "automatic")}{state.league && !state.config.league ? ` (${state.league})` : ""}</option>
          {state.leagues.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <h3>{tr("Segunda tela", "Second screen")}</h3>
      <div className="row">
        <select
          value={displayId ?? ""}
          onChange={(e) => setDisplayId(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">{tr("escolha um monitor…", "choose a monitor…")}</option>
          {displays.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label} — {d.width}×{d.height}
              {d.primary ? tr(" (principal)", " (primary)") : ""}
            </option>
          ))}
        </select>
        <button
          disabled={displayId === null}
          onClick={() => displayId !== null && void window.hub.moveDashboard(displayId, state.config.dashboardFullscreen)}
        >
          {tr("Mover o painel para cá", "Move the dashboard here")}
        </button>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={state.config.dashboardFullscreen}
          onChange={(e) => {
            void window.hub.setConfig({ dashboardFullscreen: e.target.checked });
            if (displayId !== null) void window.hub.moveDashboard(displayId, e.target.checked);
          }}
        />
        {tr("Tela cheia nesse monitor", "Fullscreen on that monitor")}
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={state.config.tradeAlerts}
          onChange={(e) => void window.hub.setConfig({ tradeAlerts: e.target.checked })}
        />
        {tr("Cartões de pedido de compra quando alguém te sussurra pelo site do trade (convidar, trade, obrigado...)", "Buy request cards when someone whispers you from the trade site (invite, trade, thanks...)")}
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={state.config.showDiagTab}
          onChange={(e) => void window.hub.setConfig({ showDiagTab: e.target.checked })}
        />
        {tr("Mostrar a aba Diagnóstico (o que o app entendeu do log, para relatar problemas)", "Show the Diagnostics tab (what the app understood from the log, for bug reports)")}
      </label>
      <div className="row buttons">
        <button onClick={() => void window.hub.setConfig({ welcomeDone: false })}>{tr("Rever a introdução", "Show the introduction again")}</button>
        <button onClick={() => void window.hub.reportProblem()} title={tr("Copia o relatório de diagnóstico e abre o GitHub para você colar", "Copies the diagnostic report and opens GitHub for you to paste it")}>
          {tr("Reportar problema", "Report a problem")}
        </button>
      </div>

      <h3>Windows</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={state.startWithWindows}
          onChange={(e) => void window.hub.setStartWithWindows(e.target.checked)}
        />
        {tr("Iniciar com o Windows (fica na bandeja até o jogo abrir)", "Start with Windows (stays in the tray until the game starts)")}
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={state.config.showDashboardOnGameStart}
          onChange={(e) => void window.hub.setConfig({ showDashboardOnGameStart: e.target.checked })}
        />
        {tr("Abrir o painel sozinho quando o jogo abrir", "Open the dashboard when the game starts")}
      </label>

      <div className="muted small">{tr("Fechar a janela deixa o app na bandeja do Windows; para sair, clique com o botão direito no ícone e escolha Sair.", "Closing the window keeps the app in the Windows tray; to quit, right-click the icon and choose Quit.")}</div>

      <h3>{tr("Overlay no jogo", "In-game overlay")}</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={state.config.overlayEnabled}
          onChange={(e) => void window.hub.setConfig({ overlayEnabled: e.target.checked })}
        />
        {tr("Mostrar overlay (F9 liga/desliga)", "Show the overlay (F9 toggles)")}
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={state.config.overlayHideUnfocused}
          onChange={(e) => void window.hub.setConfig({ overlayHideUnfocused: e.target.checked })}
        />
        {tr("Esconder o overlay quando o jogo está fechado ou fora de foco (alt-tab)", "Hide the overlay while the game is closed or unfocused (alt-tab)")}
      </label>
      <div className="muted">
        {tr(
          "F10 deixa o overlay clicável para arrastar ou usar anterior/próximo; aperte de novo para travar. O jogo precisa estar em tela cheia em janela (windowed fullscreen) para o overlay aparecer por cima.",
          "F10 makes the overlay clickable to drag it or use previous/next; press it again to lock it. The game must run in windowed fullscreen for the overlay to show on top.",
        )}
      </div>

      <ChatCommandsSettings state={state} />
    </PanelBox>
  );
}

function LanguageSelect({ value }: { value: AppState["config"]["language"] }) {
  return (
    <select value={value} onChange={(e) => void window.hub.setConfig({ language: e.target.value as typeof value })}>
      <option value="auto">{tr("Automático (idioma do Windows)", "Automatic (Windows language)")}</option>
      <option value="pt">Português (Brasil)</option>
      <option value="en">English</option>
    </select>
  );
}

/** First start: find Client.txt, then what the keys do. Shown again from Configurações. */
function Welcome({ state }: { state: AppState }) {
  const [msg, setMsg] = useState<string | null>(null);
  const done = () => void window.hub.setConfig({ welcomeDone: true });
  const logOk = state.logStatus === "watching" || state.logStatus === "waiting";
  return (
    <div className="welcome-backdrop">
      <div className="welcome">
        <h2>{tr("Bem-vindo ao Exile Hub", "Welcome to Exile Hub")}</h2>
        <div className="row">
          <span className="muted">{tr("Idioma", "Language")}</span>
          <LanguageSelect value={state.config.language} />
        </div>
        <p className="muted">{tr("O app lê o log do jogo (Client.txt) e entende sozinho onde você está. Três passos rápidos:", "The app reads the game's log (Client.txt) and works out where you are on its own. Three quick steps:")}</p>

        <h3>{tr("1. Log do jogo", "1. Game log")}</h3>
        {logOk ? (
          <div>
            <span className="good-text">✓ {tr("encontrado", "found")}</span> <span className="path">{state.config.clientLogPath}</span>
          </div>
        ) : (
          <>
            <div className="muted small">{tr("Fica na pasta do Path of Exile, em logs\\Client.txt.", "It is in the Path of Exile folder, under logs\\Client.txt.")}</div>
            <div className="row buttons">
              <button
                onClick={async () => {
                  const p = await window.hub.detectLog();
                  setMsg(p ? null : tr("não encontrei nos lugares de costume: escolha o arquivo", "not found in the usual places: choose the file"));
                }}
              >
                {tr("Detectar automaticamente", "Detect automatically")}
              </button>
              <button onClick={() => void window.hub.pickLog()}>{tr("Escolher arquivo…", "Choose file…")}</button>
            </div>
            {msg && <div className="warn-text small">{msg}</div>}
          </>
        )}

        <h3>{tr("2. Atalhos no jogo", "2. In-game keys")}</h3>
        <table className="farm-items">
          <tbody>
            <tr>
              <td><b>Ctrl+D</b></td>
              <td>{tr("com o mouse sobre um item: preço ao lado do item (sem esta tecla, o Ctrl+C dá o preço)", "with the mouse over an item: its price next to it (without this key, Ctrl+C prices)")}</td>
            </tr>
            <tr>
              <td><b>F9</b></td>
              <td>{tr("mostra / esconde o overlay", "shows / hides the overlay")}</td>
            </tr>
            <tr>
              <td><b>F10</b></td>
              <td>{tr("deixa o overlay clicável para arrastar (aperte de novo para voltar)", "makes the overlay clickable to drag it (press again to go back)")}</td>
            </tr>
            <tr>
              <td><b>F5</b></td>
              <td>{tr("vai para o hideout (outros comandos em Configurações)", "goes to your hideout (more commands in Settings)")}</td>
            </tr>
          </tbody>
        </table>

        <h3>{tr("3. Seu build (opcional)", "3. Your build (optional)")}</h3>
        <p className="small">
          {tr(
            "Copie o código ou o link (pobb.in, pastebin) do Path of Building: o app importa sozinho, mostra as gemas e a árvore e compara itens do price check com o que você usa.",
            "Copy the code or the link (pobb.in, pastebin) in Path of Building: the app imports it on its own, shows the gems and the tree and compares price-checked items with what you wear.",
          )}
        </p>

        <div className="row buttons">
          <button className="primary" onClick={done}>
            {tr("Começar", "Start")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DashboardApp() {
  const state = useHubState();
  const [visible, setVisible] = useState<Panel[]>(loadVisible);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(visible));
    } catch {
      /* ignore */
    }
  }, [visible]);

  if (!state) return <div className="loading">{tr("carregando…", "loading…")}</div>;

  const toggle = (p: Panel) =>
    setVisible((v) => (v.includes(p) ? v.filter((x) => x !== p) : [...v, p]));

  return (
    <div className="dash">
      <header className="topbar">
        <div className="brand">Exile Hub</div>
        <div className="status">
          <span className={`dot ${state.logStatus}`} />
          {state.areaName ?? tr("nenhuma zona ainda", "no zone yet")}
          {" · "}
          <CharacterPicker state={state} />
          {/* the picker already shows "Name (Class level)" */}
          {state.characterLevel !== null && !state.knownCharacters.length ? ` · ${tr("nível", "level")} ${state.characterLevel}` : ""}
        </div>
        <div className="chips">
          {/* act timers only mean something in the campaign: no button for them in endgame */}
          {ALL_PANELS.filter((p) => (p.id !== "diag" || state.config.showDiagTab) && (p.id !== "timers" || !state.endgame)).map((p) => (
            <button
              key={p.id}
              className={`chip${visible.includes(p.id) ? " on" : ""}`}
              onClick={() => toggle(p.id)}
            >
              {p.label()}
            </button>
          ))}
        </div>
      </header>
      <main className="grid">
        {visible.includes("campaign") && <CampaignPanel state={state} />}
        {visible.includes("price") && <PricePanel state={state} />}
        {visible.includes("gear") && <GearPanel state={state} />}
        {visible.includes("maps") && <MapsPanel state={state} />}
        {visible.includes("sessions") && <SessionsPanel state={state} />}
        {visible.includes("farm") && <FarmPanel state={state} />}
        {visible.includes("search") && <SearchPanel state={state} />}
        {visible.includes("build") && <BuildPanel state={state} />}
        {visible.includes("challenges") && (
          <PanelBox title={tr("Challenges da liga", "League challenges")}>
            <ChallengesPanelBody />
          </PanelBox>
        )}
        {visible.includes("timers") && <TimersPanel state={state} />}
        {visible.includes("settings") && <SettingsPanel state={state} />}
        {state.config.showDiagTab && visible.includes("diag") && <DiagPanel state={state} />}
      </main>
      {!state.config.welcomeDone && <Welcome state={state} />}
      <footer className="legal">
        <UpdateBadge u={state.update} />
        <button className="link small" onClick={() => void window.hub.reportProblem()} title={tr("Copia o relatório de diagnóstico e abre o GitHub para você colar", "Copies the diagnostic report and opens GitHub for you to paste it")}>
          {tr("Reportar problema", "Report a problem")}
        </button>{" "}
        {DONATE_URL && (
          <>
            <button className="link small" onClick={() => void window.hub.openDonate()} title={tr("O app é e continua grátis: a doação é só um apoio ao desenvolvimento", "The app is and stays free: a donation only supports development")}>
              {tr("Apoiar o projeto", "Support the project")}
            </button>{" "}
          </>
        )}
        {tr("Exile Hub é um projeto independente.", "Exile Hub is an independent project.")} This product isn't affiliated with or endorsed by Grinding Gear Games in
        any way.
      </footer>
    </div>
  );
}
