import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Anchor, Ship, Eye, EyeOff, Skull, Download, Info, X,
  Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, Waves, Compass
} from "lucide-react";
import { storage } from "./storage";

// ————————————————————————————————————————————————
// Teoría: P(total en mesa >= k) para X ~ Binomial(n, p)
// ————————————————————————————————————————————————
function survivalProb(n, p, k) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (n === 0) return 0;
  let pmf = Math.pow(1 - p, n);
  let sumBelow = 0;
  for (let i = 0; i < k; i++) {
    sumBelow += pmf;
    pmf = pmf * ((n - i) / (i + 1)) * (p / (1 - p));
  }
  return Math.max(0, Math.min(1, 1 - sumBelow));
}

const DiceIcon = ({ face, size = 28, className = "" }) => {
  const icons = { 1: Dice1, 2: Dice2, 3: Dice3, 4: Dice4, 5: Dice5, 6: Dice6 };
  const Comp = icons[face] || Dice1;
  return <Comp size={size} className={className} strokeWidth={1.75} />;
};

const TABLES = ["A", "B", "C", "D", "E", "F"];
const MAX_SEATS = 3;
const START_DICE = 5;

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function rollDice(count) {
  return Array.from({ length: count }, () => 1 + Math.floor(Math.random() * 6));
}

function matchingCount(diceArr, face) {
  if (face === 1) return diceArr.filter((d) => d === 1).length;
  return diceArr.filter((d) => d === face || d === 1).length;
}

function emptyTable(id) {
  return {
    id,
    phase: "waiting", // waiting | playing | reveal | finished
    players: [], // {id, name, diceCount, dice:[]}
    turnIdx: 0,
    round: 1,
    currentBid: null, // {playerId, playerName, qty, face}
    lastReveal: null,
    winnerId: null,
  };
}

async function getTable(id) {
  try {
    const r = await storage.get(`ldice:table:${id}`, true);
    return r ? JSON.parse(r.value) : emptyTable(id);
  } catch {
    return emptyTable(id);
  }
}
async function setTable(id, state) {
  await storage.set(`ldice:table:${id}`, JSON.stringify(state), true);
}
async function appendLog(id, entry) {
  let arr = [];
  try {
    const r = await storage.get(`ldice:log:${id}`, true);
    arr = r ? JSON.parse(r.value) : [];
  } catch {
    arr = [];
  }
  arr.push(entry);
  await storage.set(`ldice:log:${id}`, JSON.stringify(arr), true);
}
async function getLog(id) {
  try {
    const r = await storage.get(`ldice:log:${id}`, true);
    return r ? JSON.parse(r.value) : [];
  } catch {
    return [];
  }
}

function activePlayers(players) {
  return players.filter((p) => p.diceCount > 0);
}
function totalDiceInPlay(players) {
  return activePlayers(players).reduce((s, p) => s + p.diceCount, 0);
}
function nextActiveIdx(players, fromIdx) {
  const n = players.length;
  let i = (fromIdx + 1) % n;
  let guard = 0;
  while (players[i].diceCount <= 0 && guard < n) {
    i = (i + 1) % n;
    guard++;
  }
  return i;
}

// ———————————————————————————————————————————————— bot support
async function doBid(tableId, t, actor, qty, face) {
  const cb = t.currentBid;
  const othersDiceTotal = totalDiceInPlay(t.players) - actor.diceCount;
  const ownMatch = matchingCount(actor.dice, face);
  const p = face === 1 ? 1 / 6 : 1 / 3;
  const theoreticalP = survivalProb(othersDiceTotal, p, qty - ownMatch);

  await appendLog(tableId, {
    ts: Date.now(),
    table: tableId,
    round: t.round,
    playerId: actor.id,
    playerName: actor.name,
    isBot: actor.id.startsWith("bot-"),
    action: "bid",
    prevBidQty: cb?.qty ?? null,
    prevBidFace: cb?.face ?? null,
    newBidQty: qty,
    newBidFace: face,
    ownDiceCount: actor.diceCount,
    ownMatchingCount: ownMatch,
    totalDiceInPlay: totalDiceInPlay(t.players),
    theoreticalP_newBid: Number(theoreticalP.toFixed(4)),
  });

  t.currentBid = { playerId: actor.id, playerName: actor.name, qty, face };
  t.turnIdx = nextActiveIdx(t.players, t.turnIdx);
  await setTable(tableId, t);
  return t;
}

async function doChallenge(tableId, t, actor) {
  const cb = t.currentBid;
  const othersDiceTotal = totalDiceInPlay(t.players) - actor.diceCount;
  const ownMatch = matchingCount(actor.dice, cb.face);
  const p = cb.face === 1 ? 1 / 6 : 1 / 3;
  const theoreticalP = survivalProb(othersDiceTotal, p, cb.qty - ownMatch);

  const active = activePlayers(t.players);
  const actualTotal = active.reduce((s, pl) => s + matchingCount(pl.dice, cb.face), 0);
  const bidWasValid = actualTotal >= cb.qty;
  const loserId = bidWasValid ? actor.id : cb.playerId;

  await appendLog(tableId, {
    ts: Date.now(),
    table: tableId,
    round: t.round,
    playerId: actor.id,
    playerName: actor.name,
    isBot: actor.id.startsWith("bot-"),
    action: "challenge",
    prevBidQty: cb.qty,
    prevBidFace: cb.face,
    bidderId: cb.playerId,
    ownDiceCount: actor.diceCount,
    ownMatchingCount: ownMatch,
    totalDiceInPlay: totalDiceInPlay(t.players),
    theoreticalP_prevBid: Number(theoreticalP.toFixed(4)),
    actualTotal,
    bidWasBlof: !bidWasValid,
    loserId,
  });

  const loser = t.players.find((pl) => pl.id === loserId);
  loser.diceCount = Math.max(0, loser.diceCount - 1);

  t.phase = "reveal";
  t.lastReveal = {
    face: cb.face,
    qty: cb.qty,
    actualTotal,
    bidWasValid,
    bidderId: cb.playerId,
    bidderName: cb.playerName,
    challengerId: actor.id,
    challengerName: actor.name,
    loserId,
    snapshot: active.map((pl) => ({ id: pl.id, name: pl.name, dice: pl.dice })),
  };
  await setTable(tableId, t);
  return t;
}

function botDecide(t, bot) {
  const cb = t.currentBid;
  const totalDice = totalDiceInPlay(t.players);
  const othersDice = totalDice - bot.diceCount;
  if (!cb) {
    let bestFace = 2,
      bestCount = -1;
    for (let f = 2; f <= 6; f++) {
      const c = matchingCount(bot.dice, f);
      if (c > bestCount) {
        bestCount = c;
        bestFace = f;
      }
    }
    return { action: "bid", qty: Math.max(1, bestCount + 1), face: bestFace };
  }
  const ownMatch = matchingCount(bot.dice, cb.face);
  const p = cb.face === 1 ? 1 / 6 : 1 / 3;
  const theoreticalP = survivalProb(othersDice, p, cb.qty - ownMatch);
  const bluffTolerance = 0.3 + Math.random() * 0.15;
  if (theoreticalP < bluffTolerance) return { action: "challenge" };
  return { action: "bid", qty: cb.qty + 1, face: cb.face };
}

async function runBotTurn(tableId) {
  await new Promise((r) => setTimeout(r, 600 + Math.random() * 1000));
  const t = await getTable(tableId);
  if (t.phase !== "playing") return;
  const turnP = t.players[t.turnIdx];
  if (!turnP || !turnP.id.startsWith("bot-")) return;
  const decision = botDecide(t, turnP);
  if (decision.action === "challenge" && t.currentBid) {
    await doChallenge(tableId, t, turnP);
  } else if (decision.action === "bid") {
    await doBid(tableId, t, turnP, decision.qty, decision.face);
  }
}

async function addBot(tableId) {
  const t = await getTable(tableId);
  if (t.phase !== "waiting" || t.players.length >= MAX_SEATS) return t;
  const n = t.players.filter((p) => p.id.startsWith("bot-")).length + 1;
  t.players.push({
    id: `bot-${uid()}`,
    name: `Bot ${n}`,
    diceCount: START_DICE,
    dice: [],
    isBot: true,
  });
  await setTable(tableId, t);
  return t;
}

async function resetTable(id) {
  await setTable(id, emptyTable(id));
}
async function resetAllTables() {
  for (const t of TABLES) await resetTable(t);
}

// ————————————————————————————————————————————————
export default function App() {
  const [screen, setScreen] = useState("join"); // join | lobby | game | admin
  const [name, setName] = useState("");
  const [tableId, setTableId] = useState(null);
  const [playerId] = useState(uid());
  const [table, setTableState] = useState(null);
  const [joinError, setJoinError] = useState("");
  const [showRules, setShowRules] = useState(false);
  const pollRef = useRef(null);
  const prevScreenRef = useRef("join");

  function goAdmin() {
    prevScreenRef.current = screen;
    setScreen("admin");
  }

  const [bidQty, setBidQty] = useState(1);
  const [bidFace, setBidFace] = useState(2);

  const refresh = useCallback(async () => {
    if (!tableId) return;
    const t = await getTable(tableId);
    setTableState(t);
    if (t.phase === "playing") {
      runBotTurn(tableId); // fire-and-forget; only acts if it's actually a bot's turn
    }
  }, [tableId]);

  useEffect(() => {
    if (tableId && (screen === "lobby" || screen === "game")) {
      refresh();
      pollRef.current = setInterval(refresh, 1400);
      return () => clearInterval(pollRef.current);
    }
  }, [tableId, screen, refresh]);

  useEffect(() => {
    if (table && table.phase !== "waiting" && screen === "lobby") setScreen("game");
    if (table && table.phase === "waiting" && screen === "game") setScreen("lobby");
  }, [table, screen]);

  async function handleJoin(chosenTable) {
    setJoinError("");
    if (!name.trim()) {
      setJoinError("Escribe tu nombre.");
      return;
    }
    const t = await getTable(chosenTable);
    if (t.phase !== "waiting") {
      setJoinError("Esa mesa ya empezó a jugar. Elige otra.");
      return;
    }
    if (t.players.length >= MAX_SEATS) {
      setJoinError("Esa mesa está llena.");
      return;
    }
    t.players.push({ id: playerId, name: name.trim(), diceCount: START_DICE, dice: [] });
    await setTable(chosenTable, t);
    setTableId(chosenTable);
    setScreen("lobby");
  }

  async function startGame() {
    const t = await getTable(tableId);
    if (t.players.length < 3) return;
    t.players = t.players.map((p) => ({ ...p, diceCount: START_DICE, dice: rollDice(START_DICE) }));
    t.phase = "playing";
    t.turnIdx = 0;
    t.round = 1;
    t.currentBid = null;
    t.lastReveal = null;
    await setTable(tableId, t);
    setTableState(t);
  }

  const me = table?.players.find((p) => p.id === playerId);
  const isMyTurn =
    table && table.phase === "playing" && table.players[table.turnIdx]?.id === playerId;

  async function submitBid() {
    const t = await getTable(tableId);
    if (t.players[t.turnIdx]?.id !== playerId || t.phase !== "playing") {
      setTableState(t);
      return;
    }
    const cb = t.currentBid;
    const valid = !cb || bidQty > cb.qty || (bidQty === cb.qty && bidFace > cb.face);
    if (!valid) return;
    const meNow = t.players.find((p) => p.id === playerId);
    const updated = await doBid(tableId, t, meNow, bidQty, bidFace);
    setTableState(updated);
  }

  async function submitChallenge() {
    const t = await getTable(tableId);
    if (t.players[t.turnIdx]?.id !== playerId || t.phase !== "playing" || !t.currentBid) {
      setTableState(t);
      return;
    }
    const meNow = t.players.find((p) => p.id === playerId);
    const updated = await doChallenge(tableId, t, meNow);
    setTableState(updated);
  }

  async function handleAddBot() {
    const t = await addBot(tableId);
    setTableState(t);
  }

  async function nextRound() {
    const t = await getTable(tableId);
    if (t.phase !== "reveal") return;
    const stillActive = activePlayers(t.players);
    if (stillActive.length <= 1) {
      t.phase = "finished";
      t.winnerId = stillActive[0]?.id ?? null;
      await setTable(tableId, t);
      setTableState(t);
      return;
    }
    const loserIdx = t.players.findIndex((p) => p.id === t.lastReveal.loserId);
    t.players = t.players.map((p) =>
      p.diceCount > 0 ? { ...p, dice: rollDice(p.diceCount) } : p
    );
    t.currentBid = null;
    t.lastReveal = null;
    t.round += 1;
    t.phase = "playing";
    t.turnIdx = t.players[loserIdx]?.diceCount > 0 ? loserIdx : nextActiveIdx(t.players, loserIdx);
    await setTable(tableId, t);
    setTableState(t);
  }

  useEffect(() => {
    if (table?.currentBid) {
      setBidQty(table.currentBid.qty);
      setBidFace(table.currentBid.face < 6 ? table.currentBid.face + 1 : table.currentBid.face);
    } else {
      setBidQty(1);
      setBidFace(2);
    }
  }, [table?.currentBid, table?.round, table?.phase]);

  if (screen === "admin") {
    return <AdminPanel onBack={() => setScreen(prevScreenRef.current)} />;
  }

  return (
    <div style={s.page}>
      <div style={s.bgGrain} />
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={s.brand}>
            <Anchor size={22} color="#C9A227" strokeWidth={1.75} />
            <span style={s.brandText}>Dados del Mentiroso</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={s.ghostBtn} onClick={() => setShowRules(true)}>
              <Info size={16} /> Reglas
            </button>
            <button style={s.ghostBtn} onClick={goAdmin}>
              <Download size={16} /> Datos
            </button>
          </div>
        </div>
      </header>

      <main style={s.main}>
        {screen === "join" && (
          <JoinScreen
            name={name}
            setName={setName}
            onJoin={handleJoin}
            error={joinError}
            onAdmin={() => setScreen("admin")}
          />
        )}
        {screen === "lobby" && table && (
          <LobbyScreen
            table={table}
            onStart={startGame}
            onAddBot={handleAddBot}
            playerId={playerId}
          />
        )}
        {screen === "game" && table && (
          <GameScreen
            table={table}
            me={me}
            playerId={playerId}
            isMyTurn={isMyTurn}
            bidQty={bidQty}
            setBidQty={setBidQty}
            bidFace={bidFace}
            setBidFace={setBidFace}
            onBid={submitBid}
            onChallenge={submitChallenge}
            onNextRound={nextRound}
          />
        )}
      </main>

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}

// ————————————————————————————————————————————————
function JoinScreen({ name, setName, onJoin, error, onAdmin }) {
  const [selected, setSelected] = useState(null);
  const [counts, setCounts] = useState({});

  useEffect(() => {
    let cancel = false;
    async function load() {
      const c = {};
      for (const t of TABLES) {
        const st = await getTable(t);
        c[t] = { n: st.players.length, phase: st.phase };
      }
      if (!cancel) setCounts(c);
    }
    load();
    const iv = setInterval(load, 1800);
    return () => {
      cancel = true;
      clearInterval(iv);
    };
  }, []);

  return (
    <div style={s.card}>
      <div style={s.heroRow}>
        <Waves size={20} color="#7FA69A" />
        <h1 style={s.h1}>Súbete al Holandés Errante</h1>
      </div>
      <p style={s.sub}>
        Elige tu nombre y una mesa. Son 6 mesas, 3 marineros cada una, todas jugando al mismo
        tiempo.
      </p>

      <label style={s.label}>Tu nombre</label>
      <input
        style={s.input}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Bootstrap Bill"
        maxLength={20}
      />

      <div style={s.tableGrid}>
        {TABLES.map((t) => {
          const c = counts[t] || { n: 0, phase: "waiting" };
          const full = c.n >= MAX_SEATS;
          const started = c.phase !== "waiting";
          const disabled = full || started;
          return (
            <button
              key={t}
              disabled={disabled}
              onClick={() => setSelected(t)}
              style={{
                ...s.tableCard,
                ...(selected === t ? s.tableCardSelected : {}),
                ...(disabled ? s.tableCardDisabled : {}),
              }}
            >
              <Ship size={20} color={disabled ? "#5a6b6f" : "#C9A227"} />
              <div style={s.tableCardName}>Mesa {t}</div>
              <div style={s.tableCardMeta}>
                {started ? "En juego" : `${c.n}/${MAX_SEATS} tripulantes`}
              </div>
            </button>
          );
        })}
      </div>

      {error && <div style={s.error}>{error}</div>}

      <button
        style={{ ...s.primaryBtn, opacity: selected ? 1 : 0.5 }}
        disabled={!selected}
        onClick={() => onJoin(selected)}
      >
        Sentarme en la mesa {selected || ""}
      </button>

      <button style={s.linkBtn} onClick={onAdmin}>
        Panel de investigador — ver / exportar datos
      </button>
    </div>
  );
}

function LobbyScreen({ table, onStart, onAddBot, playerId }) {
  const full = table.players.length >= MAX_SEATS;
  return (
    <div style={s.card}>
      <div style={s.heroRow}>
        <Compass size={20} color="#7FA69A" />
        <h1 style={s.h1}>Mesa {table.id} — esperando tripulación</h1>
      </div>
      <ul style={s.playerList}>
        {table.players.map((p) => (
          <li key={p.id} style={s.playerRow}>
            <Anchor size={14} color={p.isBot ? "#7FA69A" : "#C9A227"} />
            <span>{p.name}</span>
            {p.isBot && <span style={s.botTag}>bot</span>}
            {p.id === playerId && <span style={s.youTag}>tú</span>}
          </li>
        ))}
      </ul>
      <p style={s.sub}>
        {table.players.length < 3
          ? `Faltan al menos ${3 - table.players.length} jugador(es) más para empezar.`
          : "Cualquiera en la mesa puede iniciar la partida."}
      </p>
      <button
        style={{ ...s.primaryBtn, opacity: table.players.length >= 3 ? 1 : 0.5 }}
        disabled={table.players.length < 3}
        onClick={onStart}
      >
        Iniciar partida
      </button>
      <button style={s.ghostBtnFull} disabled={full} onClick={onAddBot}>
        + Agregar bot de prueba
      </button>
      <p style={s.smallNote}>
        Los bots deciden con la misma fórmula de probabilidad que vimos (suben, desafían o
        blofean con algo de variación aleatoria). Sirven para probar el flujo del juego solos,
        pero exclúyelos del análisis real filtrando <code>isBot=true</code> en el CSV.
      </p>
    </div>
  );
}

function GameScreen({
  table, me, playerId, isMyTurn, bidQty, setBidQty, bidFace, setBidFace,
  onBid, onChallenge, onNextRound,
}) {
  if (table.phase === "finished") {
    const winner = table.players.find((p) => p.id === table.winnerId);
    return (
      <div style={s.card}>
        <div style={s.heroRow}>
          <Anchor size={22} color="#C9A227" />
          <h1 style={s.h1}>Fin de la partida — Mesa {table.id}</h1>
        </div>
        <p style={{ ...s.sub, fontSize: 18 }}>
          🏆 <strong>{winner?.name}</strong> se queda con el último dado y gana la mesa.
        </p>
      </div>
    );
  }

  if (table.phase === "reveal") {
    const r = table.lastReveal;
    return (
      <div style={s.card}>
        <div style={s.heroRow}>
          <Eye size={20} color="#C9A227" />
          <h1 style={s.h1}>¡Se destapan los dados!</h1>
        </div>
        <p style={s.sub}>
          <strong>{r.bidderName}</strong> apostó {r.qty}× cara {r.face === 1 ? "🂡" : r.face}.{" "}
          <strong>{r.challengerName}</strong> desafió.
        </p>
        <div style={s.revealGrid}>
          {r.snapshot.map((pl) => (
            <div key={pl.id} style={s.revealRow}>
              <span style={s.revealName}>{pl.name}</span>
              <div style={s.diceRow}>
                {pl.dice.map((d, i) => (
                  <DiceIcon key={i} face={d} size={22} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <p style={{ ...s.sub, fontWeight: 600 }}>
          Total real: {r.actualTotal} — la apuesta era {r.bidWasValid ? "VÁLIDA" : "un BLOF"}.{" "}
          Pierde un dado: {r.snapshot.find((p) => p.id === r.loserId)?.name}.
        </p>
        <button style={s.primaryBtn} onClick={onNextRound}>
          Siguiente ronda
        </button>
      </div>
    );
  }

  const turnPlayer = table.players[table.turnIdx];
  const cb = table.currentBid;

  return (
    <div style={s.card}>
      <div style={s.heroRow}>
        <Ship size={20} color="#7FA69A" />
        <h1 style={s.h1}>Mesa {table.id} — Ronda {table.round}</h1>
      </div>

      <div style={s.seatsRow}>
        {table.players.map((p) => (
          <div
            key={p.id}
            style={{
              ...s.seat,
              ...(p.id === turnPlayer?.id ? s.seatActive : {}),
              opacity: p.diceCount > 0 ? 1 : 0.35,
            }}
          >
            {p.diceCount > 0 ? (
              <EyeOff size={16} color="#8a7a55" />
            ) : (
              <Skull size={16} color="#7a3b3b" />
            )}
            <div style={s.seatName}>
              {p.name}
              {p.id === playerId ? " (tú)" : ""}
            </div>
            <div style={s.seatDice}>{p.diceCount} 🎲</div>
          </div>
        ))}
      </div>

      <div style={s.bidBanner}>
        {cb ? (
          <>
            Apuesta actual: <strong>{cb.qty}×</strong>{" "}
            <DiceIcon face={cb.face} size={18} /> de <strong>{cb.playerName}</strong>
          </>
        ) : (
          "Sin apuesta todavía — abre la ronda"
        )}
      </div>

      <div style={s.myDiceBox}>
        <div style={s.label}>Tus dados ({me?.diceCount ?? 0})</div>
        <div style={s.diceRow}>
          {me?.dice.map((d, i) => (
            <DiceIcon key={i} face={d} size={30} />
          ))}
        </div>
      </div>

      {isMyTurn ? (
        <div style={s.actionBox}>
          <div style={s.turnTag}>Tu turno</div>
          <div style={s.bidControls}>
            <div style={s.stepperGroup}>
              <span style={s.label}>Cantidad</span>
              <div style={s.stepper}>
                <button style={s.stepBtn} onClick={() => setBidQty((q) => Math.max(1, q - 1))}>
                  −
                </button>
                <span style={s.stepVal}>{bidQty}</span>
                <button style={s.stepBtn} onClick={() => setBidQty((q) => q + 1)}>
                  +
                </button>
              </div>
            </div>
            <div style={s.stepperGroup}>
              <span style={s.label}>Cara</span>
              <div style={s.faceRow}>
                {[1, 2, 3, 4, 5, 6].map((f) => (
                  <button
                    key={f}
                    onClick={() => setBidFace(f)}
                    style={{
                      ...s.faceBtn,
                      ...(bidFace === f ? s.faceBtnActive : {}),
                    }}
                  >
                    <DiceIcon face={f} size={18} />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div style={s.actionRow}>
            <button style={s.primaryBtn} onClick={onBid}>
              Subir apuesta
            </button>
            {cb && (
              <button style={s.dangerBtn} onClick={onChallenge}>
                <Skull size={16} /> Desafiar
              </button>
            )}
          </div>
        </div>
      ) : (
        <p style={s.sub}>Esperando a {turnPlayer?.name}…</p>
      )}
    </div>
  );
}

function RulesModal({ onClose }) {
  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modalCard} onClick={(e) => e.stopPropagation()}>
        <button style={s.modalClose} onClick={onClose}>
          <X size={18} />
        </button>
        <h2 style={s.h2}>Reglas (versión simplificada)</h2>
        <ul style={s.rulesList}>
          <li>Cada jugador empieza con 5 dados ocultos, visibles solo para sí mismo.</li>
          <li>Por turnos, subes la apuesta (más cantidad, o misma cantidad y cara más alta) o desafías la apuesta anterior.</li>
          <li>La cara 1 es comodín: cuenta para cualquier apuesta sobre otra cara.</li>
          <li>Al desafiar, se destapan todos los dados. Si la apuesta era cierta, pierde un dado quien desafió; si era un blof, pierde un dado quien apostó.</li>
          <li>Quien se queda sin dados es eliminado. Gana el último con dados.</li>
        </ul>
      </div>
    </div>
  );
}

// ———————————————————————————————————————————————— Panel de investigador (v2: descarga real de CSV)
function AdminPanel({ onBack }) {
  const [logs, setLogs] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const out = {};
    for (const t of TABLES) {
      out[t] = await getLog(t);
    }
    setLogs(out);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function downloadCsv() {
    const headers = [
      "table", "round", "ts", "playerId", "playerName", "isBot", "action",
      "prevBidQty", "prevBidFace", "newBidQty", "newBidFace",
      "ownDiceCount", "ownMatchingCount", "totalDiceInPlay",
      "theoreticalP_newBid", "theoreticalP_prevBid",
      "bidderId", "actualTotal", "bidWasBlof", "loserId",
    ];
    const rows = [headers.join(",")];
    for (const t of TABLES) {
      for (const e of logs[t] || []) {
        rows.push(
          headers
            .map((h) => (e[h] !== undefined && e[h] !== null ? String(e[h]).replace(/,/g, ";") : ""))
            .join(",")
        );
      }
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dados_del_mentiroso_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const totalEntries = TABLES.reduce((s, t) => s + (logs[t]?.length || 0), 0);

  return (
    <div style={s.page}>
      <div style={s.bgGrain} />
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={s.brand}>
            <Anchor size={22} color="#C9A227" />
            <span style={s.brandText}>Panel de investigador</span>
          </div>
          <button style={s.ghostBtn} onClick={onBack}>
            Volver
          </button>
        </div>
      </header>
      <main style={s.main}>
        <div style={s.card}>
          <h1 style={s.h1}>Registro de decisiones</h1>
          <p style={s.sub}>
            {loading ? "Cargando…" : `${totalEntries} decisiones registradas en total.`}
          </p>
          <div style={s.tableGrid}>
            {TABLES.map((t) => (
              <div key={t} style={s.tableCard}>
                <Ship size={18} color="#C9A227" />
                <div style={s.tableCardName}>Mesa {t}</div>
                <div style={s.tableCardMeta}>{logs[t]?.length || 0} registros</div>
              </div>
            ))}
          </div>
          <button style={s.primaryBtn} onClick={downloadCsv} disabled={loading || totalEntries === 0}>
            <Download size={16} style={{ marginRight: 6 }} /> Descargar CSV
          </button>
          <button style={s.linkBtn} onClick={load}>
            Actualizar
          </button>
          <button
            style={{ ...s.ghostBtnFull, marginTop: 14, borderColor: "rgba(139,58,47,0.5)", color: "#e2938a" }}
            onClick={async () => {
              await resetAllTables();
              load();
            }}
          >
            Vaciar todas las mesas (borra jugadores sentados, no borra el CSV)
          </button>
        </div>
      </main>
    </div>
  );
}

// ————————————————————————————————————————————————
const s = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(180deg,#0B1622 0%,#0E1E2C 55%,#0B1622 100%)",
    fontFamily: "'Georgia', 'Iowan Old Style', serif",
    color: "#EDE3C8",
    position: "relative",
    overflow: "hidden",
  },
  bgGrain: {
    position: "absolute",
    inset: 0,
    backgroundImage:
      "radial-gradient(circle at 20% 20%, rgba(201,162,39,0.06), transparent 40%), radial-gradient(circle at 80% 70%, rgba(127,166,154,0.06), transparent 40%)",
    pointerEvents: "none",
  },
  header: {
    position: "relative",
    borderBottom: "1px solid rgba(201,162,39,0.25)",
    padding: "14px 16px",
  },
  headerInner: {
    maxWidth: 480,
    margin: "0 auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brand: { display: "flex", alignItems: "center", gap: 8 },
  brandText: { fontSize: 16, letterSpacing: 0.4, fontWeight: 700, color: "#EDE3C8" },
  main: { position: "relative", padding: "20px 14px 60px", maxWidth: 480, margin: "0 auto" },
  card: {
    background: "rgba(237,227,200,0.04)",
    border: "1px solid rgba(201,162,39,0.22)",
    borderRadius: 14,
    padding: 20,
    boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
  },
  heroRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 },
  h1: { fontSize: 20, margin: 0, fontWeight: 700, letterSpacing: 0.2 },
  h2: { fontSize: 18, margin: "0 0 10px", fontWeight: 700 },
  sub: { fontSize: 14, lineHeight: 1.5, color: "#C9BFA0", margin: "6px 0 16px" },
  label: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.8, color: "#9c8f6a", fontFamily: "system-ui, sans-serif" },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid rgba(201,162,39,0.35)",
    background: "rgba(0,0,0,0.25)",
    color: "#EDE3C8",
    fontSize: 15,
    marginTop: 6,
    marginBottom: 16,
    fontFamily: "system-ui, sans-serif",
  },
  tableGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 },
  tableCard: {
    background: "rgba(0,0,0,0.25)",
    border: "1px solid rgba(201,162,39,0.3)",
    borderRadius: 10,
    padding: "14px 8px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    cursor: "pointer",
    fontFamily: "system-ui, sans-serif",
  },
  tableCardSelected: { borderColor: "#C9A227", background: "rgba(201,162,39,0.12)" },
  tableCardDisabled: { cursor: "not-allowed", opacity: 0.4 },
  tableCardName: { fontSize: 14, fontWeight: 700 },
  tableCardMeta: { fontSize: 11, color: "#9c8f6a" },
  primaryBtn: {
    width: "100%",
    padding: "13px 16px",
    borderRadius: 10,
    border: "none",
    background: "linear-gradient(180deg,#D9B347,#C9A227)",
    color: "#1a1408",
    fontWeight: 700,
    fontSize: 15,
    cursor: "pointer",
    fontFamily: "system-ui, sans-serif",
    marginBottom: 10,
  },
  dangerBtn: {
    flex: 1,
    padding: "13px 16px",
    borderRadius: 10,
    border: "1px solid rgba(139,58,47,0.6)",
    background: "rgba(139,58,47,0.25)",
    color: "#f0c9c0",
    fontWeight: 700,
    fontSize: 15,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    fontFamily: "system-ui, sans-serif",
  },
  ghostBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "transparent",
    border: "1px solid rgba(201,162,39,0.35)",
    color: "#C9A227",
    borderRadius: 8,
    padding: "7px 12px",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "system-ui, sans-serif",
  },
  linkBtn: {
    display: "block",
    margin: "6px auto 0",
    background: "none",
    border: "none",
    color: "#7FA69A",
    fontSize: 13,
    textDecoration: "underline",
    cursor: "pointer",
    fontFamily: "system-ui, sans-serif",
  },
  error: { color: "#e2938a", fontSize: 13, marginBottom: 10, fontFamily: "system-ui, sans-serif" },
  playerList: { listStyle: "none", padding: 0, margin: "10px 0" },
  playerRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 0",
    borderBottom: "1px solid rgba(201,162,39,0.1)",
    fontFamily: "system-ui, sans-serif",
    fontSize: 14,
  },
  youTag: {
    marginLeft: "auto",
    fontSize: 10,
    background: "rgba(201,162,39,0.2)",
    padding: "2px 8px",
    borderRadius: 20,
    color: "#C9A227",
  },
  botTag: {
    fontSize: 10,
    background: "rgba(127,166,154,0.2)",
    padding: "2px 8px",
    borderRadius: 20,
    color: "#7FA69A",
  },
  ghostBtnFull: {
    width: "100%",
    padding: "11px 16px",
    borderRadius: 10,
    border: "1px dashed rgba(127,166,154,0.5)",
    background: "transparent",
    color: "#7FA69A",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    fontFamily: "system-ui, sans-serif",
    marginBottom: 8,
  },
  seatsRow: { display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, marginBottom: 10 },
  seat: {
    minWidth: 84,
    background: "rgba(0,0,0,0.25)",
    border: "1px solid rgba(201,162,39,0.2)",
    borderRadius: 10,
    padding: "10px 8px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    fontFamily: "system-ui, sans-serif",
  },
  seatActive: { borderColor: "#C9A227", boxShadow: "0 0 0 1px #C9A227 inset" },
  seatName: { fontSize: 11, textAlign: "center" },
  seatDice: { fontSize: 11, color: "#9c8f6a" },
  bidBanner: {
    background: "rgba(127,166,154,0.1)",
    border: "1px solid rgba(127,166,154,0.3)",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 14,
    marginBottom: 14,
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    fontFamily: "system-ui, sans-serif",
  },
  myDiceBox: { marginBottom: 16 },
  diceRow: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 },
  actionBox: {
    background: "rgba(0,0,0,0.2)",
    border: "1px solid rgba(201,162,39,0.25)",
    borderRadius: 12,
    padding: 14,
  },
  turnTag: {
    fontSize: 12,
    fontWeight: 700,
    color: "#1a1408",
    background: "#C9A227",
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: 20,
    marginBottom: 12,
    fontFamily: "system-ui, sans-serif",
  },
  bidControls: { display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" },
  stepperGroup: { display: "flex", flexDirection: "column", gap: 6 },
  stepper: { display: "flex", alignItems: "center", gap: 10 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    border: "1px solid rgba(201,162,39,0.4)",
    background: "rgba(0,0,0,0.3)",
    color: "#EDE3C8",
    fontSize: 18,
    cursor: "pointer",
  },
  stepVal: { fontSize: 16, fontWeight: 700, minWidth: 20, textAlign: "center" },
  faceRow: { display: "flex", gap: 6 },
  faceBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    border: "1px solid rgba(201,162,39,0.3)",
    background: "rgba(0,0,0,0.25)",
    color: "#EDE3C8",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  faceBtnActive: { borderColor: "#C9A227", background: "rgba(201,162,39,0.25)" },
  actionRow: { display: "flex", gap: 10 },
  revealGrid: { display: "flex", flexDirection: "column", gap: 8, margin: "10px 0 16px" },
  revealRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "rgba(0,0,0,0.2)",
    borderRadius: 8,
    padding: "8px 12px",
    fontFamily: "system-ui, sans-serif",
    fontSize: 13,
  },
  revealName: { fontWeight: 700, marginRight: 10 },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    zIndex: 50,
  },
  modalCard: {
    background: "#0E1E2C",
    border: "1px solid rgba(201,162,39,0.3)",
    borderRadius: 14,
    padding: 22,
    maxWidth: 420,
    position: "relative",
    color: "#EDE3C8",
  },
  modalClose: {
    position: "absolute",
    top: 12,
    right: 12,
    background: "none",
    border: "none",
    color: "#C9A227",
    cursor: "pointer",
  },
  rulesList: {
    fontSize: 14,
    lineHeight: 1.6,
    color: "#C9BFA0",
    paddingLeft: 18,
    fontFamily: "system-ui, sans-serif",
  },
  smallNote: {
    fontSize: 12,
    color: "#8a7a55",
    marginTop: 12,
    fontFamily: "system-ui, sans-serif",
  },
};
