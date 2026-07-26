const STORAGE_KEY = "riftboundMatches";
const DRAFT_KEY = "riftboundFormDraft";

const CHAMPION_SEEDS = [
  "Ahri", "Annie", "Darius", "Garen", "Jinx", "Lee Sin", "Lux",
  "Master Yi", "Teemo", "Viktor", "Volibear", "Yasuo",
];

// chrome.storage.local when running as an extension, localStorage otherwise
// (so the popup can be opened as a plain page during development).
const store = {
  async get(key) {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const data = await chrome.storage.local.get(key);
      return data[key];
    }
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  },
  async set(key, value) {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [key]: value });
      return;
    }
    localStorage.setItem(key, JSON.stringify(value));
  },
};

const form = document.getElementById("match-form");
const historyList = document.getElementById("history");
const emptyState = document.getElementById("empty-state");
const statsEl = document.getElementById("stats");

let matches = [];

async function init() {
  matches = (await store.get(STORAGE_KEY)) ?? [];
  await restoreDraft();
  render();

  form.addEventListener("submit", onSubmit);
  form.addEventListener("input", saveDraft);
  document.getElementById("export-btn").addEventListener("click", exportJson);
  document.getElementById("clear-btn").addEventListener("click", clearAll);
  historyList.addEventListener("click", onHistoryClick);
}

function readForm() {
  const data = new FormData(form);
  return {
    result: data.get("result"),
    format: data.get("format"),
    champion: (data.get("champion") || "").trim(),
    deck: (data.get("deck") || "").trim(),
    battlefield: (data.get("battlefield") || "").trim(),
    opponent: (data.get("opponent") || "").trim(),
    mulligan: data.get("mulligan") === "on",
    notes: (data.get("notes") || "").trim(),
  };
}

async function onSubmit(event) {
  event.preventDefault();
  const entry = { id: crypto.randomUUID(), playedAt: new Date().toISOString(), ...readForm() };
  matches.unshift(entry);
  await store.set(STORAGE_KEY, matches);

  // Keep format/champion/deck/battlefield for the next entry; reset the rest.
  const keep = {
    format: entry.format,
    champion: entry.champion,
    deck: entry.deck,
    battlefield: entry.battlefield,
  };
  form.reset();
  applyDraft(keep);
  await store.set(DRAFT_KEY, keep);
  render();
}

async function saveDraft() {
  const { result, mulligan, notes, opponent, ...persisted } = readForm();
  await store.set(DRAFT_KEY, persisted);
}

async function restoreDraft() {
  applyDraft((await store.get(DRAFT_KEY)) ?? {});
}

function applyDraft(draft) {
  if (draft.format) form.elements.format.value = draft.format;
  if (draft.champion) form.elements.champion.value = draft.champion;
  if (draft.deck) form.elements.deck.value = draft.deck;
  if (draft.battlefield) form.elements.battlefield.value = draft.battlefield;
}

async function onHistoryClick(event) {
  const button = event.target.closest(".match-delete");
  if (!button) return;
  matches = matches.filter((m) => m.id !== button.dataset.id);
  await store.set(STORAGE_KEY, matches);
  render();
}

async function clearAll() {
  if (!matches.length || !confirm("Delete all saved matches?")) return;
  matches = [];
  await store.set(STORAGE_KEY, matches);
  render();
}

function exportJson() {
  const blob = new Blob([JSON.stringify(matches, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `riftbound-matches-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function render() {
  renderStats();
  renderHistory();
  renderSuggestions();
}

function renderStats() {
  if (!matches.length) {
    statsEl.textContent = "No matches yet — log your first one below.";
    return;
  }
  const wins = matches.filter((m) => m.result === "win").length;
  const losses = matches.filter((m) => m.result === "loss").length;
  const draws = matches.length - wins - losses;
  const decided = wins + losses;
  const rate = decided ? Math.round((wins / decided) * 100) : 0;
  statsEl.textContent =
    `${matches.length} matches · ${wins}W ${losses}L${draws ? ` ${draws}D` : ""} · ${rate}% win rate`;
}

function renderHistory() {
  historyList.replaceChildren();
  emptyState.hidden = matches.length > 0;

  for (const m of matches) {
    const li = document.createElement("li");
    li.className = "match";

    const top = document.createElement("div");
    top.className = "match-top";

    const badge = document.createElement("span");
    badge.className = `badge ${m.result}`;
    badge.textContent = m.result;

    const champ = document.createElement("span");
    champ.className = "match-champion";
    champ.textContent = m.champion + (m.opponent ? ` vs ${m.opponent}` : "");

    const del = document.createElement("button");
    del.type = "button";
    del.className = "match-delete";
    del.dataset.id = m.id;
    del.textContent = "✕";
    del.title = "Delete this match";

    top.append(badge, champ, del);
    li.append(top);

    const metaParts = [
      m.format,
      m.deck && `Deck: ${m.deck}`,
      m.battlefield && `Battlefield: ${m.battlefield}`,
      m.mulligan ? "Mulliganed" : "Kept hand",
      new Date(m.playedAt).toLocaleDateString(),
    ].filter(Boolean);

    const meta = document.createElement("div");
    meta.className = "match-meta";
    meta.textContent = metaParts.join(" · ");
    li.append(meta);

    if (m.notes) {
      const notes = document.createElement("div");
      notes.className = "match-notes";
      notes.textContent = m.notes;
      li.append(notes);
    }

    historyList.append(li);
  }
}

function renderSuggestions() {
  fillDatalist(
    "champion-suggestions",
    [...CHAMPION_SEEDS, ...matches.flatMap((m) => [m.champion, m.opponent])],
  );
  fillDatalist("deck-suggestions", matches.map((m) => m.deck));
  fillDatalist("battlefield-suggestions", matches.map((m) => m.battlefield));
}

function fillDatalist(id, values) {
  const datalist = document.getElementById(id);
  const unique = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  datalist.replaceChildren(
    ...unique.map((value) => Object.assign(document.createElement("option"), { value })),
  );
}

init();
