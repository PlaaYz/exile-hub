import { useEffect, useState, type ReactNode } from "react";
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
import { Frags, StepView } from "./StepView";

const ALL_PANELS: { id: Panel; label: string }[] = [
  { id: "campaign", label: "Campanha" },
  { id: "price", label: "Preço" },
  { id: "maps", label: "Mapas" },
  { id: "sessions", label: "Sessões" },
  { id: "farm", label: "Farm" },
  { id: "search", label: "Buscas" },
  { id: "build", label: "Build" },
  { id: "challenges", label: "Challenges" },
  { id: "timers", label: "Tempos" },
  { id: "settings", label: "Configurações" },
  { id: "diag", label: "Diagnóstico" },
];
const BUILD_SOURCE = { manual: "colado aqui", clipboard: "pego do clipboard", saved: "restaurado da última sessão" };
const LS_KEY = "exile-hub.visiblePanels.v8"; // bump when a panel is added so it shows up

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
  if (!list.length) return <span>{current ?? "personagem ?"}</span>;
  return (
    <select
      className={`char-pick${current ? "" : " unknown"}`}
      value={current ?? ""}
      title="O jogo só informa o personagem quando ele sobe de nível ou morre: escolha aqui se o app não souber"
      onChange={(e) => e.target.value && void window.hub.setCharacter(e.target.value)}
    >
      {!current && <option value="">quem está jogando?</option>}
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
      <PanelBox title="Campanha">
        <div className="muted">
          Você está no endgame ({state.areaName ?? "mapa"}): a rota da campanha fica pausada e o overlay mostra os mapas.
          Ela volta sozinha quando você entrar numa zona da campanha.
        </div>
      </PanelBox>
    );
  }
  return (
    <PanelBox title={`Campanha — Ato ${t.act || "–"}`}>
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
          Você está numa zona que a rota não esperava ({state.areaName ?? "?"}).{" "}
          <button onClick={() => void window.hub.routeSync()}>Sincronizar com a zona atual</button>
        </div>
      )}
      {t.done ? (
        <p>Rota concluída.</p>
      ) : (
        <ul className="steps">
          {t.block.map((s) => (
            <StepView key={s.id} step={s} />
          ))}
        </ul>
      )}
      {t.next && (
        <div className="next">
          Próximo: <Frags fragments={t.next.fragments} />
        </div>
      )}
      <div className="row buttons">
        <button onClick={() => void window.hub.routePrev()}>◀ Zona anterior</button>
        <button onClick={() => void window.hub.routeNext()}>Próxima zona ▶</button>
        <button onClick={() => void window.hub.routeSync()}>Sincronizar</button>
        <button className="danger" onClick={() => void window.hub.routeReset()}>
          Reiniciar run
        </button>
      </div>
    </PanelBox>
  );
}

function PricePanel({ state }: { state: AppState }) {
  return (
    <PanelBox title="Preço (price check)" className="panel-tall">
      {!state.config.priceCheckEnabled && (
        <div className="warn">Price check desligado nas configurações.</div>
      )}
      {state.config.priceCheckEnabled && !state.league && <div className="warn">Carregando ligas…</div>}
      <PricePanelBody p={state.price} />
    </PanelBox>
  );
}

function UpdateBadge({ u }: { u: AppState["update"] }) {
  const text: Record<AppState["update"]["status"], string> = {
    disabled: u.message ?? "atualização automática desligada",
    checking: "procurando atualização…",
    latest: "atualizado",
    downloading: `baixando ${u.version ?? ""}${u.progress !== null ? ` (${u.progress}%)` : ""}…`,
    ready: `versão ${u.version} pronta: instala ao fechar o app`,
    error: `não foi possível verificar atualizações${u.message ? ` (${u.message})` : ""}`,
  };
  return (
    <span className="update-badge">
      v{u.current} · {text[u.status]}
      {u.status === "ready" && (
        <button className="primary small-btn" onClick={() => void window.hub.installUpdate()}>
          Reiniciar e atualizar
        </button>
      )}
      {" · "}
    </span>
  );
}

function SessionsPanel({ state }: { state: AppState }) {
  return (
    <PanelBox title="Sessões de jogo">
      <SessionsPanelBody state={state} />
    </PanelBox>
  );
}

function SearchPanel({ state }: { state: AppState }) {
  return (
    <PanelBox title="Buscas (cole no baú/vendedor)" className="panel-tall">
      <SearchPanelBody state={state} />
    </PanelBox>
  );
}

function DiagPanel({ state }: { state: AppState }) {
  return (
    <PanelBox title="Diagnóstico" className="panel-tall">
      <DiagPanelBody state={state} />
    </PanelBox>
  );
}

function MapsPanel({ state }: { state: AppState }) {
  return (
    <PanelBox title="Mapas" className="panel-tall">
      <MapsPanelBody maps={state.maps} />
    </PanelBox>
  );
}

function FarmPanel({ state }: { state: AppState }) {
  return (
    <PanelBox title="Farm de bosses — valor esperado" className="panel-tall panel-wide">
      <FarmPanelBody runs={state.farmRuns} />
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
    setMsg(res.ok ? "Importado." : `Falha ao importar: ${res.error ?? "erro desconhecido"}`);
    if (res.ok) setInput("");
  };

  return (
    <PanelBox title="Build (Path of Building)" className="panel-tall">
      <div className="muted small">
        {state.buildInfo
          ? `Build ${BUILD_SOURCE[state.buildInfo.source]} · ${new Date(state.buildInfo.at).toLocaleString("pt-BR")}`
          : "Copie o código ou o link (pobb.in / pastebin) no Path of Building: o app importa sozinho."}
      </div>
      <textarea
        placeholder="Cole um código do PoB ou um link do pastebin.com / pobb.in"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={3}
      />
      <div className="row">
        <button disabled={busy || !input.trim()} onClick={() => void doImport()}>
          {busy ? "Importando…" : "Importar"}
        </button>
        {msg && <span className={msg.startsWith("Falha ao importar") ? "warn-text" : "muted"}>{msg}</span>}
      </div>
      {state.tree && <TreePanel tree={state.tree} />}
      {b && (
        <>
          <h3>Gemas</h3>
          <p className="muted">
            {b.className}
            {b.ascendClass ? ` / ${b.ascendClass}` : ""} · build nível {b.level} · {b.treeNodes.length} passivos
            {lvl !== null ? ` · você está no nível ${lvl}` : ""}
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
                      title={gem.requiredLevel !== null ? `requer nível ${gem.requiredLevel}` : "nível desconhecido"}
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
    <PanelBox title="Tempos">
      <div className="big">{fmtMs(t.runMs)}</div>
      <div className="muted">tempo total{t.act ? ` · Ato ${t.act}: ${fmtMs(t.actMs)}` : ""}</div>
      <table className="splits">
        <tbody>
          {acts.map((a) => (
            <tr key={a}>
              <td>Ato {a}</td>
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
    "no-path": "nenhum Client.txt selecionado",
    waiting: "aguardando o arquivo aparecer",
    watching: "acompanhando o Client.txt",
    error: `erro: ${state.logError ?? "desconhecido"}`,
  };

  return (
    <PanelBox title="Configurações">
      <h3>Client.txt</h3>
      <div className="path">{state.config.clientLogPath ?? "—"}</div>
      <div className="muted">{statusText[state.logStatus]}</div>
      <div className="row buttons">
        <button onClick={() => void window.hub.pickLog()}>Escolher arquivo…</button>
        <button
          onClick={async () => {
            const p = await window.hub.detectLog();
            setDetectMsg(p ? `encontrado: ${p}` : "não encontrado nos lugares de costume, escolha manualmente");
          }}
        >
          Detectar automaticamente
        </button>
      </div>
      {detectMsg && <div className="muted">{detectMsg}</div>}

      <h3>Rota da campanha</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={state.config.leagueStart}
          onChange={(e) => void window.hub.setConfig({ leagueStart: e.target.checked })}
        />
        Rota de início de liga (passos extras: waypoints antecipados, trials do Lab, equipamento inicial)
      </label>

      <h3>Price check</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={state.config.priceCheckEnabled}
          onChange={(e) => void window.hub.setConfig({ priceCheckEnabled: e.target.checked })}
        />
        Precificar itens copiados no jogo (Ctrl+C sobre o item)
      </label>
      {state.chat.supported && state.config.priceCheckEnabled && (
        <div className="row">
          <span className="muted">Tecla do price check</span>
          <KeyInput value={state.config.priceCheckKey ?? ""} onChange={(k) => void window.hub.setConfig({ priceCheckKey: k })} />
          {state.config.priceCheckKey && (
            <button className="small" onClick={() => void window.hub.setConfig({ priceCheckKey: null })}>
              desligar
            </button>
          )}
          <span className="muted small">
            com o mouse sobre o item: o app copia (Ctrl+Alt+C, com os tiers) e abre o preço ao lado; Esc fecha
          </span>
        </div>
      )}
      <div className="row">
        <span className="muted">Liga</span>
        <select
          value={state.config.league ?? ""}
          onChange={(e) => void window.hub.setConfig({ league: e.target.value === "" ? null : e.target.value })}
        >
          <option value="">automática{state.league && !state.config.league ? ` (${state.league})` : ""}</option>
          {state.leagues.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <h3>Segunda tela</h3>
      <div className="row">
        <select
          value={displayId ?? ""}
          onChange={(e) => setDisplayId(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">escolha um monitor…</option>
          {displays.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label} — {d.width}×{d.height}
              {d.primary ? " (principal)" : ""}
            </option>
          ))}
        </select>
        <button
          disabled={displayId === null}
          onClick={() => displayId !== null && void window.hub.moveDashboard(displayId, state.config.dashboardFullscreen)}
        >
          Mover o painel para cá
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
        Tela cheia nesse monitor
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={state.config.tradeAlerts}
          onChange={(e) => void window.hub.setConfig({ tradeAlerts: e.target.checked })}
        />
        Cartões de pedido de compra quando alguém te sussurra pelo site do trade (convidar, trade, obrigado...)
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={state.config.showDiagTab}
          onChange={(e) => void window.hub.setConfig({ showDiagTab: e.target.checked })}
        />
        Mostrar a aba Diagnóstico (o que o app entendeu do log, para relatar problemas)
      </label>

      <h3>Windows</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={state.startWithWindows}
          onChange={(e) => void window.hub.setStartWithWindows(e.target.checked)}
        />
        Iniciar com o Windows (fica na bandeja até o jogo abrir)
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={state.config.showDashboardOnGameStart}
          onChange={(e) => void window.hub.setConfig({ showDashboardOnGameStart: e.target.checked })}
        />
        Abrir o painel sozinho quando o jogo abrir
      </label>

      <div className="muted small">Fechar a janela deixa o app na bandeja do Windows; para sair, clique com o botão direito no ícone e escolha Sair.</div>

      <h3>Overlay no jogo</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={state.config.overlayEnabled}
          onChange={(e) => void window.hub.setConfig({ overlayEnabled: e.target.checked })}
        />
        Mostrar overlay (F9 liga/desliga)
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={state.config.overlayHideUnfocused}
          onChange={(e) => void window.hub.setConfig({ overlayHideUnfocused: e.target.checked })}
        />
        Esconder o overlay quando o jogo está fechado ou fora de foco (alt-tab)
      </label>
      <div className="muted">
        F10 deixa o overlay clicável para arrastar ou usar anterior/próximo; aperte de novo para travar. O jogo
        precisa estar em tela cheia em janela (windowed fullscreen) para o overlay aparecer por cima.
      </div>

      <ChatCommandsSettings state={state} />
    </PanelBox>
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

  if (!state) return <div className="loading">carregando…</div>;

  const toggle = (p: Panel) =>
    setVisible((v) => (v.includes(p) ? v.filter((x) => x !== p) : [...v, p]));

  return (
    <div className="dash">
      <header className="topbar">
        <div className="brand">Exile Hub</div>
        <div className="status">
          <span className={`dot ${state.logStatus}`} />
          {state.areaName ?? "nenhuma zona ainda"}
          {" · "}
          <CharacterPicker state={state} />
          {state.characterLevel !== null ? ` · nível ${state.characterLevel}` : ""}
        </div>
        <div className="chips">
          {ALL_PANELS.filter((p) => p.id !== "diag" || state.config.showDiagTab).map((p) => (
            <button
              key={p.id}
              className={`chip${visible.includes(p.id) ? " on" : ""}`}
              onClick={() => toggle(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>
      <main className="grid">
        {visible.includes("campaign") && <CampaignPanel state={state} />}
        {visible.includes("price") && <PricePanel state={state} />}
        {visible.includes("maps") && <MapsPanel state={state} />}
        {visible.includes("sessions") && <SessionsPanel state={state} />}
        {visible.includes("farm") && <FarmPanel state={state} />}
        {visible.includes("search") && <SearchPanel state={state} />}
        {visible.includes("build") && <BuildPanel state={state} />}
        {visible.includes("challenges") && (
          <PanelBox title="Challenges da liga">
            <ChallengesPanelBody />
          </PanelBox>
        )}
        {visible.includes("timers") && <TimersPanel state={state} />}
        {visible.includes("settings") && <SettingsPanel state={state} />}
        {state.config.showDiagTab && visible.includes("diag") && <DiagPanel state={state} />}
      </main>
      <footer className="legal">
        <UpdateBadge u={state.update} />
        Exile Hub é um projeto independente. This product isn't affiliated with or endorsed by Grinding Gear Games in
        any way.
      </footer>
    </div>
  );
}
