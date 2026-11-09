import { useState, type KeyboardEvent } from "react";
import { CHAT_COMMAND_PRESETS, isValidKey, isValidText, LAST_WHISPER, normaliseKey, type ChatCommand } from "../core/chatCommands";
import type { AppState } from "../shared/types";

/** Turns a key press into an accelerator ("F5", "Ctrl+H"); null for bare modifiers. */
function acceleratorOf(e: KeyboardEvent): string | null {
  const k = e.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(k)) return null;
  const main = /^F\d{1,2}$/.test(k) ? k : /^[a-z0-9]$/i.test(k) ? k.toUpperCase() : null;
  if (!main) return null;
  const mods = [e.ctrlKey && "Ctrl", e.shiftKey && "Shift", e.altKey && "Alt"].filter(Boolean);
  return normaliseKey([...mods, main].join("+"));
}

export function KeyInput({ value, onChange }: { value: string; onChange: (k: string) => void }) {
  const [hint, setHint] = useState<string | null>(null);
  return (
    <input
      className="key-input"
      readOnly
      value={hint ?? value}
      title="Clique e aperte a tecla (F1–F12, ou Ctrl/Shift/Alt + letra/número)"
      onBlur={() => setHint(null)}
      onKeyDown={(e) => {
        if (e.key === "Tab") return;
        e.preventDefault();
        const acc = acceleratorOf(e);
        if (!acc) return;
        if (!isValidKey(acc)) {
          setHint(`${acc}: não dá`);
          return;
        }
        setHint(null);
        onChange(acc);
      }}
    />
  );
}

export function ChatCommandsSettings({ state }: { state: AppState }) {
  const cfg = state.config;
  const cmds = cfg.chatCommands;
  const save = (next: ChatCommand[]) => void window.hub.setConfig({ chatCommands: next });
  const freeKey = () => ["F5", "F6", "F7", "F8", "F11", "F12", "F1", "F2", "F3", "F4"].find((k) => !cmds.some((c) => c.key === k));

  return (
    <>
      <h3>Comandos no teclado</h3>
      {!state.chat.supported ? (
        <div className="muted">Disponível só na versão instalada do app.</div>
      ) : (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={cfg.chatCommandsEnabled}
              onChange={(e) => void window.hub.setConfig({ chatCommandsEnabled: e.target.checked })}
            />
            Atalhos que digitam um comando no chat do jogo (ex.: F5 = /hideout)
          </label>
          <div className="muted small">
            Uma tecla = um comando, como no Awakened PoE Trade. As teclas só valem com o jogo em foco; fora dele continuam
            normais nos outros programas. {LAST_WHISPER} vira o último jogador que te sussurrou
            {state.chat.lastWhisper ? ` (agora: ${state.chat.lastWhisper})` : " (ninguém ainda)"}.
            {cfg.chatCommandsEnabled && (state.chat.active ? " Atalhos ativos." : " Atalhos ativos quando o jogo estiver em foco.")}
          </div>
          <table className="chat-commands">
            <tbody>
              {cmds.map((c, i) => (
                <tr key={c.key}>
                  <td>
                    <KeyInput
                      value={c.key}
                      onChange={(k) => !cmds.some((x, j) => j !== i && x.key === k) && save(cmds.map((x, j) => (j === i ? { ...x, key: k } : x)))}
                    />
                  </td>
                  <td>
                    <CommandText value={c.text} onSave={(t) => save(cmds.map((x, j) => (j === i ? { ...x, text: t } : x)))} />
                  </td>
                  <td>
                    <button onClick={() => save(cmds.filter((_, j) => j !== i))}>remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <select
              value=""
              disabled={!freeKey()}
              onChange={(e) => {
                const key = freeKey();
                if (key && e.target.value) save([...cmds, { key, text: e.target.value }]);
              }}
            >
              <option value="">adicionar comando…</option>
              {CHAT_COMMAND_PRESETS.map((p) => (
                <option key={p.text} value={p.text}>
                  {p.label} — {p.text}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </>
  );
}

/** Edited locally, saved on blur/Enter when valid (a half-typed command never reaches the game). */
function CommandText({ value, onSave }: { value: string; onSave: (t: string) => void }) {
  const [draft, setDraft] = useState(value);
  const ok = isValidText(draft.trim());
  const commit = () => {
    if (ok && draft.trim() !== value) onSave(draft.trim());
    else if (!ok) setDraft(value);
  };
  return (
    <input
      className={ok ? "" : "invalid"}
      value={draft}
      maxLength={120}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      title="Comece com / (comando) ou @ (sussurro)"
    />
  );
}
