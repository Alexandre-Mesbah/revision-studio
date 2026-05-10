const FOCUS_SESSION_SECONDS = 6 * 60 * 60;
const STORAGE_KEY = "revision-six-hour-app";
const RING_LENGTH = 2 * Math.PI * 96;

const defaultTasks = [
  {
    text: "Lister les chapitres a revoir",
    steps: ["Identifier les priorites", "Noter les notions floues"],
  },
  {
    text: "Relire le cours actif",
    steps: ["Surligner les formules", "Resumer en 5 lignes"],
  },
  {
    text: "Refaire les exercices rates",
    steps: ["Refaire sans correction", "Comparer avec le corrige"],
  },
  {
    text: "Faire un mini test sans notes",
    steps: ["Chronometrer 20 minutes", "Corriger les erreurs"],
  },
];

const elements = {
  viewTabs: document.querySelectorAll(".view-tab"),
  viewPanels: document.querySelectorAll(".view-panel"),
  manualSave: document.querySelector("#manual-save"),
  overallProgressLabel: document.querySelector("#overall-progress-label"),
  overallProgressBar: document.querySelector("#overall-progress-bar"),
  focusToggle: document.querySelector("#focus-toggle"),
  focusReset: document.querySelector("#focus-reset"),
  focusState: document.querySelector("#focus-state"),
  focusTime: document.querySelector("#focus-time"),
  focusElapsed: document.querySelector("#focus-elapsed"),
  focusRing: document.querySelector("#focus-ring"),
  pomodoroToggle: document.querySelector("#pomodoro-toggle"),
  pomodoroSkip: document.querySelector("#pomodoro-skip"),
  pomodoroReset: document.querySelector("#pomodoro-reset"),
  pomodoroMode: document.querySelector("#pomodoro-mode"),
  pomodoroTime: document.querySelector("#pomodoro-time"),
  pomodoroCount: document.querySelector("#pomodoro-count"),
  focusMinutes: document.querySelector("#focus-minutes"),
  shortBreakMinutes: document.querySelector("#short-break-minutes"),
  longBreakMinutes: document.querySelector("#long-break-minutes"),
  longBreakEvery: document.querySelector("#long-break-every"),
  taskForm: document.querySelector("#task-form"),
  taskInput: document.querySelector("#task-input"),
  taskList: document.querySelector("#task-list"),
  taskCount: document.querySelector("#task-count"),
  doneCount: document.querySelector("#done-count"),
  clearDone: document.querySelector("#clear-done"),
  resetDefaults: document.querySelector("#reset-defaults"),
  exportData: document.querySelector("#export-data"),
  importData: document.querySelector("#import-data"),
  clearAll: document.querySelector("#clear-all"),
  storagePreview: document.querySelector("#storage-preview"),
};

let state = loadState();
let ticker = null;

function createId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createStep(text, done = false) {
  return {
    id: createId(),
    text,
    done,
  };
}

function createTask(text, steps = [], done = false) {
  return {
    id: createId(),
    text,
    done,
    steps: steps.map((step) => (typeof step === "string" ? createStep(step) : createStep(step.text, Boolean(step.done)))),
  };
}

function getDefaultState() {
  return {
    activeView: "focus",
    focus: {
      remainingSeconds: FOCUS_SESSION_SECONDS,
      running: false,
      lastStartedAt: null,
    },
    pomodoro: {
      mode: "focus",
      remainingSeconds: 25 * 60,
      running: false,
      lastStartedAt: null,
      completedFocusSessions: 0,
      settings: {
        focusMinutes: 25,
        shortBreakMinutes: 5,
        longBreakMinutes: 20,
        longBreakEvery: 4,
      },
    },
    tasks: defaultTasks.map((task) => createTask(task.text, task.steps)),
    lastSavedAt: null,
  };
}

function normalizeTasks(tasks, fallbackTasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return fallbackTasks;
  }

  return tasks.map((task) => ({
    id: task.id || createId(),
    text: String(task.text || "Tache sans titre"),
    done: Boolean(task.done),
    steps: Array.isArray(task.steps)
      ? task.steps.map((step) => ({
          id: step.id || createId(),
          text: String(step.text || "Etape"),
          done: Boolean(step.done),
        }))
      : [],
  }));
}

function loadState() {
  const fallback = getDefaultState();

  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored) {
      return fallback;
    }

    if ("remainingSeconds" in stored && !stored.focus) {
      return {
        ...fallback,
        focus: {
          remainingSeconds: clampSeconds(stored.remainingSeconds, FOCUS_SESSION_SECONDS),
          running: Boolean(stored.running && stored.remainingSeconds > 0),
          lastStartedAt: stored.lastStartedAt || null,
        },
        tasks: normalizeTasks(stored.tasks, fallback.tasks),
        lastSavedAt: stored.lastSavedAt || null,
      };
    }

    return {
      ...fallback,
      activeView: ["focus", "pomodoro", "checklist", "storage"].includes(stored.activeView) ? stored.activeView : "focus",
      focus: {
        remainingSeconds: clampSeconds(stored.focus?.remainingSeconds, FOCUS_SESSION_SECONDS),
        running: Boolean(stored.focus?.running && stored.focus?.remainingSeconds > 0),
        lastStartedAt: stored.focus?.lastStartedAt || null,
      },
      pomodoro: normalizePomodoro(stored.pomodoro, fallback.pomodoro),
      tasks: normalizeTasks(stored.tasks, fallback.tasks),
      lastSavedAt: stored.lastSavedAt || null,
    };
  } catch {
    return fallback;
  }
}

function normalizePomodoro(pomodoro, fallback) {
  const settings = {
    focusMinutes: clampNumber(pomodoro?.settings?.focusMinutes, 1, 120, fallback.settings.focusMinutes),
    shortBreakMinutes: clampNumber(pomodoro?.settings?.shortBreakMinutes, 1, 60, fallback.settings.shortBreakMinutes),
    longBreakMinutes: clampNumber(pomodoro?.settings?.longBreakMinutes, 1, 90, fallback.settings.longBreakMinutes),
    longBreakEvery: clampNumber(pomodoro?.settings?.longBreakEvery, 2, 12, fallback.settings.longBreakEvery),
  };
  const mode = ["focus", "shortBreak", "longBreak"].includes(pomodoro?.mode) ? pomodoro.mode : "focus";

  return {
    mode,
    remainingSeconds: clampSeconds(pomodoro?.remainingSeconds, getPomodoroModeSeconds(mode, settings)),
    running: Boolean(pomodoro?.running && pomodoro?.remainingSeconds > 0),
    lastStartedAt: pomodoro?.lastStartedAt || null,
    completedFocusSessions: clampNumber(pomodoro?.completedFocusSessions, 0, 999, fallback.completedFocusSessions),
    settings,
  };
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function clampSeconds(value, maxSeconds) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return maxSeconds;
  }

  return Math.max(0, Math.min(maxSeconds, Math.round(parsed)));
}

function getPomodoroModeSeconds(mode = state.pomodoro.mode, settings = state.pomodoro.settings) {
  if (mode === "shortBreak") {
    return settings.shortBreakMinutes * 60;
  }

  if (mode === "longBreak") {
    return settings.longBreakMinutes * 60;
  }

  return settings.focusMinutes * 60;
}

function saveState() {
  state.lastSavedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function syncTimer(timer) {
  if (!timer.running || !timer.lastStartedAt) {
    return false;
  }

  const elapsed = Math.floor((Date.now() - timer.lastStartedAt) / 1000);
  if (elapsed <= 0) {
    return false;
  }

  timer.remainingSeconds = Math.max(0, timer.remainingSeconds - elapsed);
  timer.lastStartedAt = Date.now();
  return timer.remainingSeconds === 0;
}

function syncElapsedTime() {
  const focusEnded = syncTimer(state.focus);
  const pomodoroEnded = syncTimer(state.pomodoro);

  if (focusEnded) {
    state.focus.running = false;
    state.focus.lastStartedAt = null;
  }

  if (pomodoroEnded) {
    completePomodoroMode();
  }

  if (focusEnded || pomodoroEnded) {
    stopTickerIfIdle();
  }
}

function formatHours(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatMinutes(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return [minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function getCompletionStats() {
  const taskTotal = state.tasks.length;
  const taskDone = state.tasks.filter((task) => task.done).length;
  const stepTotal = state.tasks.reduce((total, task) => total + task.steps.length, 0);
  const stepDone = state.tasks.reduce((total, task) => total + task.steps.filter((step) => step.done).length, 0);
  const total = taskTotal + stepTotal;
  const done = taskDone + stepDone;

  return {
    done,
    total,
    taskDone,
    taskTotal,
    percent: total ? Math.round((done / total) * 100) : 0,
  };
}

function renderView() {
  elements.viewTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.viewTarget === state.activeView);
  });
  elements.viewPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.view === state.activeView);
  });
}

function renderFocus() {
  const completedRatio = 1 - state.focus.remainingSeconds / FOCUS_SESSION_SECONDS;
  elements.focusTime.textContent = formatHours(state.focus.remainingSeconds);
  elements.focusElapsed.textContent = formatHours(FOCUS_SESSION_SECONDS - state.focus.remainingSeconds);
  elements.focusToggle.textContent = state.focus.running ? "Pause" : state.focus.remainingSeconds === 0 ? "Termine" : "Demarrer";
  elements.focusToggle.disabled = state.focus.remainingSeconds === 0;
  elements.focusState.textContent = state.focus.remainingSeconds === 0 ? "Fini" : state.focus.running ? "En cours" : "Pret";
  elements.focusRing.style.strokeDasharray = RING_LENGTH;
  elements.focusRing.style.strokeDashoffset = RING_LENGTH * completedRatio;
  elements.focusRing.style.stroke = "var(--accent)";
}

function renderPomodoro() {
  const modeLabels = {
    focus: "Focus",
    shortBreak: "Pause courte",
    longBreak: "Pause longue",
  };

  elements.pomodoroTime.textContent = formatMinutes(state.pomodoro.remainingSeconds);
  elements.pomodoroMode.textContent = modeLabels[state.pomodoro.mode];
  elements.pomodoroToggle.textContent = state.pomodoro.running ? "Pause" : "Demarrer";
  elements.pomodoroCount.textContent = state.pomodoro.completedFocusSessions;
  elements.focusMinutes.value = state.pomodoro.settings.focusMinutes;
  elements.shortBreakMinutes.value = state.pomodoro.settings.shortBreakMinutes;
  elements.longBreakMinutes.value = state.pomodoro.settings.longBreakMinutes;
  elements.longBreakEvery.value = state.pomodoro.settings.longBreakEvery;
}

function renderTasks() {
  elements.taskList.replaceChildren();

  state.tasks.forEach((task) => {
    const item = document.createElement("li");
    item.className = `task-item${task.done ? " done" : ""}`;

    const main = document.createElement("div");
    main.className = "task-main";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.done;
    checkbox.setAttribute("aria-label", `Marquer ${task.text}`);
    checkbox.addEventListener("change", () => toggleTask(task.id));

    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = task.text;

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-task";
    deleteButton.type = "button";
    deleteButton.title = "Supprimer";
    deleteButton.setAttribute("aria-label", `Supprimer ${task.text}`);
    deleteButton.textContent = "x";
    deleteButton.addEventListener("click", () => deleteTask(task.id));

    main.append(checkbox, title, deleteButton);
    item.append(main, renderStepList(task), renderStepForm(task));
    elements.taskList.append(item);
  });

  const stats = getCompletionStats();
  elements.taskCount.textContent = `${stats.taskDone}/${stats.taskTotal}`;
  elements.doneCount.textContent = `${stats.done}/${stats.total}`;
  elements.overallProgressLabel.textContent = `${stats.percent}%`;
  elements.overallProgressBar.style.width = `${stats.percent}%`;
}

function renderStepList(task) {
  const list = document.createElement("ul");
  list.className = "step-list";

  task.steps.forEach((step) => {
    const item = document.createElement("li");
    item.className = `step-item${step.done ? " done" : ""}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = step.done;
    checkbox.setAttribute("aria-label", `Marquer ${step.text}`);
    checkbox.addEventListener("change", () => toggleStep(task.id, step.id));

    const label = document.createElement("span");
    label.textContent = step.text;

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-step";
    deleteButton.type = "button";
    deleteButton.title = "Supprimer";
    deleteButton.setAttribute("aria-label", `Supprimer ${step.text}`);
    deleteButton.textContent = "x";
    deleteButton.addEventListener("click", () => deleteStep(task.id, step.id));

    item.append(checkbox, label, deleteButton);
    list.append(item);
  });

  return list;
}

function renderStepForm(task) {
  const form = document.createElement("form");
  form.className = "step-form";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Ajouter une etape";
  input.autocomplete = "off";

  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Ajouter";

  form.append(input, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    addStep(task.id, input.value);
  });

  return form;
}

function renderStorage() {
  const preview = {
    lastSavedAt: state.lastSavedAt,
    focus: state.focus,
    pomodoro: state.pomodoro,
    tasks: state.tasks,
  };

  elements.storagePreview.textContent = JSON.stringify(preview, null, 2);
}

function render() {
  renderView();
  renderFocus();
  renderPomodoro();
  renderTasks();
  renderStorage();
}

function persistAndRender(statusText) {
  saveState(statusText);
  render();
}

function startTicker() {
  if (ticker) {
    return;
  }

  ticker = window.setInterval(() => {
    syncElapsedTime();
    saveState("Sauvegarde automatique");
    render();
    stopTickerIfIdle();
  }, 1000);
}

function stopTickerIfIdle() {
  if (!state.focus.running && !state.pomodoro.running && ticker) {
    window.clearInterval(ticker);
    ticker = null;
  }
}

function toggleFocusTimer() {
  syncElapsedTime();

  if (state.focus.running) {
    state.focus.running = false;
    state.focus.lastStartedAt = null;
  } else if (state.focus.remainingSeconds > 0) {
    state.focus.running = true;
    state.focus.lastStartedAt = Date.now();
    startTicker();
  }

  stopTickerIfIdle();
  persistAndRender("Focus sauvegarde");
}

function resetFocusTimer() {
  state.focus.remainingSeconds = FOCUS_SESSION_SECONDS;
  state.focus.running = false;
  state.focus.lastStartedAt = null;
  stopTickerIfIdle();
  persistAndRender("Focus reinitialise");
}

function togglePomodoroTimer() {
  syncElapsedTime();

  if (state.pomodoro.running) {
    state.pomodoro.running = false;
    state.pomodoro.lastStartedAt = null;
  } else if (state.pomodoro.remainingSeconds > 0) {
    state.pomodoro.running = true;
    state.pomodoro.lastStartedAt = Date.now();
    startTicker();
  }

  stopTickerIfIdle();
  persistAndRender("Pomodoro sauvegarde");
}

function completePomodoroMode() {
  const completedFocus = state.pomodoro.mode === "focus";

  if (completedFocus) {
    state.pomodoro.completedFocusSessions += 1;
  }

  state.pomodoro.mode = getNextPomodoroMode(completedFocus);
  state.pomodoro.remainingSeconds = getPomodoroModeSeconds(state.pomodoro.mode, state.pomodoro.settings);
  state.pomodoro.running = false;
  state.pomodoro.lastStartedAt = null;
}

function getNextPomodoroMode(completedFocus) {
  if (!completedFocus) {
    return "focus";
  }

  const every = state.pomodoro.settings.longBreakEvery;
  return state.pomodoro.completedFocusSessions % every === 0 ? "longBreak" : "shortBreak";
}

function skipPomodoroMode() {
  syncElapsedTime();
  completePomodoroMode();
  stopTickerIfIdle();
  persistAndRender("Cycle passe");
}

function resetPomodoroTimer() {
  state.pomodoro.mode = "focus";
  state.pomodoro.remainingSeconds = getPomodoroModeSeconds("focus", state.pomodoro.settings);
  state.pomodoro.running = false;
  state.pomodoro.lastStartedAt = null;
  stopTickerIfIdle();
  persistAndRender("Pomodoro reinitialise");
}

function updatePomodoroSetting(key, value) {
  state.pomodoro.settings[key] = clampNumber(value, 1, key === "focusMinutes" ? 120 : 90, state.pomodoro.settings[key]);

  if (key === "longBreakEvery") {
    state.pomodoro.settings[key] = clampNumber(value, 2, 12, state.pomodoro.settings[key]);
  }

  if (!state.pomodoro.running) {
    state.pomodoro.remainingSeconds = getPomodoroModeSeconds(state.pomodoro.mode, state.pomodoro.settings);
  }

  persistAndRender("Reglages sauvegardes");
}

function addTask(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }

  state.tasks.unshift(createTask(trimmed));
  elements.taskInput.value = "";
  persistAndRender("Tache sauvegardee");
}

function toggleTask(taskId) {
  state.tasks = state.tasks.map((task) => (task.id === taskId ? { ...task, done: !task.done } : task));
  persistAndRender("Checklist sauvegardee");
}

function deleteTask(taskId) {
  state.tasks = state.tasks.filter((task) => task.id !== taskId);
  persistAndRender("Tache supprimee");
}

function addStep(taskId, text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }

  state.tasks = state.tasks.map((task) =>
    task.id === taskId ? { ...task, steps: [...task.steps, createStep(trimmed)] } : task,
  );
  persistAndRender("Etape sauvegardee");
}

function toggleStep(taskId, stepId) {
  state.tasks = state.tasks.map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    const steps = task.steps.map((step) => (step.id === stepId ? { ...step, done: !step.done } : step));
    const done = steps.length > 0 && steps.every((step) => step.done);
    return { ...task, steps, done };
  });
  persistAndRender("Etapes sauvegardees");
}

function deleteStep(taskId, stepId) {
  state.tasks = state.tasks.map((task) =>
    task.id === taskId ? { ...task, steps: task.steps.filter((step) => step.id !== stepId) } : task,
  );
  persistAndRender("Etape supprimee");
}

function clearDoneTasks() {
  state.tasks = state.tasks.filter((task) => !task.done);
  persistAndRender("Taches faites nettoyees");
}

function resetDefaultTasks() {
  state.tasks = getDefaultState().tasks;
  persistAndRender("Plan par defaut charge");
}

function exportState() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `revision-studio-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  persistAndRender("Export cree");
}

function importState(file) {
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const imported = JSON.parse(String(reader.result));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
      state = loadState();
      syncElapsedTime();
      persistAndRender("Import sauvegarde");
    } catch {
      elements.saveStatus.textContent = "Import invalide";
    }
  });
  reader.readAsText(file);
}

function clearAllData() {
  localStorage.removeItem(STORAGE_KEY);
  state = getDefaultState();
  stopTickerIfIdle();
  persistAndRender("Donnees reinitialisees");
}

elements.viewTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    state.activeView = tab.dataset.viewTarget;
    persistAndRender("Vue sauvegardee");
  });
});

elements.manualSave.addEventListener("click", () => persistAndRender("Enregistre localement"));
elements.focusToggle.addEventListener("click", toggleFocusTimer);
elements.focusReset.addEventListener("click", resetFocusTimer);
elements.pomodoroToggle.addEventListener("click", togglePomodoroTimer);
elements.pomodoroSkip.addEventListener("click", skipPomodoroMode);
elements.pomodoroReset.addEventListener("click", resetPomodoroTimer);
elements.focusMinutes.addEventListener("change", (event) => updatePomodoroSetting("focusMinutes", event.target.value));
elements.shortBreakMinutes.addEventListener("change", (event) =>
  updatePomodoroSetting("shortBreakMinutes", event.target.value),
);
elements.longBreakMinutes.addEventListener("change", (event) => updatePomodoroSetting("longBreakMinutes", event.target.value));
elements.longBreakEvery.addEventListener("change", (event) => updatePomodoroSetting("longBreakEvery", event.target.value));
elements.taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addTask(elements.taskInput.value);
});
elements.clearDone.addEventListener("click", clearDoneTasks);
elements.resetDefaults.addEventListener("click", resetDefaultTasks);
elements.exportData.addEventListener("click", exportState);
elements.importData.addEventListener("change", (event) => importState(event.target.files[0]));
elements.clearAll.addEventListener("click", clearAllData);

window.addEventListener("pointermove", (event) => {
  const x = Math.round((event.clientX / window.innerWidth) * 100);
  const y = Math.round((event.clientY / window.innerHeight) * 100);
  document.body.style.setProperty("--spot-x", `${x}%`);
  document.body.style.setProperty("--spot-y", `${y}%`);
});

syncElapsedTime();
saveState();
render();

if (state.focus.running || state.pomodoro.running) {
  startTicker();
}
