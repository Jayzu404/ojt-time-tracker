// =====================================================
// HOURS TRACKER (with backend)
// Idea: ONE state object (`data`) + ONE render() function.
// The server is now the source of truth. Each handler sends its
// change to the API, copies the server's answer into `data`, and
// calls render(). Totals, remaining, percentage and dates are still
// never stored, they are calculated from `data` every time (getStats).
// =====================================================

// ===== ELEMENTS =====
const totalTimeAccumulatedContainer = document.getElementById("total-hours-acc");
const remainingTimeContainer = document.getElementById("remaining-time");
const percentageContainer = document.getElementById("percent-value");
const estimateDateContainer = document.getElementById("est-date");
const estimateDaysContainer = document.getElementById("est-days");
const statusPill = document.getElementById("status-pill");
const ring = document.getElementById("ring");
const ringFill = document.getElementById("ring-fill");

const paceInput = document.getElementById("pace-input");
const stepperButtons = document.querySelectorAll(".stepper__btn");

const targetHrsInput = document.getElementById("target-hours-input");
const saveTargetHrsBtn = document.getElementById("edit-goal-btn");

const prevHoursInput = document.getElementById("prev-hrs-input");
const prevMinutesInput = document.getElementById("prev-mins-input");
const savePrevHrsBtn = document.getElementById("save-prev-hours-btn");

const resetBtn = document.getElementById("reset-btn");
const logoutBtn = document.getElementById("logout-btn");

const dateInput = document.getElementById("log-date");
const timeInInput = document.getElementById("time-in");
const timeOutInput = document.getElementById("time-out");
const logEntryBtn = document.getElementById("log-entry-btn");
const durationHrsContainer = document.getElementById("duration-value");

const entriesList = document.getElementById("entries-list");
const entryCount = document.getElementById("entry-count");
const sortSelect = document.getElementById("sort-select");

// ===== CONSTANTS =====
const RING_CIRCUMFERENCE = 502.65; // 2 * PI * r (r = 80)
const MAX_HOURS = 100000;
const MAX_PACE = 24;
const DEFAULT_PACE = 8;
const DEFAULT_TIME_IN = "09:00";
const DEFAULT_TIME_OUT = "17:30";

const TRASH_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>`;

const CALENDAR_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>`;

// ===== STATE =====
// A copy of what the server holds. Everything else is calculated.
// All time values are WHOLE MINUTES.
const data = {
  targetMinutes: 0,
  previousAccumulatedMinutes: 0,
  assumedHoursPerDay: DEFAULT_PACE,
  entries: [], // { id: "12", date: "YYYY-MM-DD", timeIn: "HH:MM", timeOut: "HH:MM", minutes }
};

// =====================================================
// CALCULATIONS (pure: numbers in, numbers out, no DOM)
// =====================================================

function timeToMinutes(time) {
  if (!time) return NaN;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function extractHrsAndMins(timeInMinutes) {
  return [Math.floor(timeInMinutes / 60), timeInMinutes % 60];
}

function formatDuration(timeInMinutes) {
  const [hours, minutes] = extractHrsAndMins(timeInMinutes);
  return `${hours}h ${minutes}m`;
}

function getStats() {
  const loggedMinutes = data.entries.reduce((sum, e) => sum + e.minutes, 0);
  const totalMinutes = data.previousAccumulatedMinutes + loggedMinutes;

  const hasTarget = data.targetMinutes > 0;
  const remainingMinutes = hasTarget
    ? Math.max(data.targetMinutes - totalMinutes, 0)
    : 0;
  const goalReached = hasTarget && remainingMinutes === 0;

  let percentage = 0;
  if (hasTarget) {
    percentage = Math.min((totalMinutes / data.targetMinutes) * 100, 100);
    percentage = Math.round(percentage * 100) / 100;
    // rounding must never show 100% while time is still remaining
    if (!goalReached) percentage = Math.min(percentage, 99.99);
  }

  // minutes / (hours per day * 60) -> no fractional-hours step needed
  const daysFromNow =
    hasTarget && !goalReached
      ? Math.ceil(remainingMinutes / (data.assumedHoursPerDay * 60))
      : null;

  return {
    totalMinutes,
    hasTarget,
    remainingMinutes,
    goalReached,
    percentage,
    daysFromNow,
  };
}

// ===== DATE HELPERS =====

function getTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(date) {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatEntryDate(dateString) {
  // build the date from parts so it stays in local time
  const [year, month, day] = dateString.split("-").map(Number);
  return formatDate(new Date(year, month - 1, day));
}

function formatClock(time) {
  const total = timeToMinutes(time);
  const hours24 = Math.floor(total / 60);
  const minutes = total % 60;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function calculateEstDateCompletion(daysFromNow) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return formatDate(date);
}

// ===== INPUT HELPERS =====

// Empty field -> 0. Invalid typing (like "-" or "e") -> NaN.
function readWholeNumber(input) {
  if (input.validity.badInput) return NaN;
  if (input.value === "") return 0;
  return input.valueAsNumber;
}

// Minutes between time in and time out, or null if not valid.
function getDurationMinutes() {
  const timeIn = timeToMinutes(timeInInput.value);
  const timeOut = timeToMinutes(timeOutInput.value);

  if (Number.isNaN(timeIn) || Number.isNaN(timeOut)) return null;
  if (timeOut <= timeIn) return null;

  return timeOut - timeIn;
}

// =====================================================
// API (talking to the server)
// =====================================================

// One helper for every request. Returns the parsed JSON (or null for 204).
// Throws an Error with .message (text for the user) and .status (HTTP code).
async function api(method, path, body) {
  const options = { method, headers: {} };

  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`/api${path}`, options);
  } catch {
    throw new Error("Could not reach the server. Check your connection.");
  }

  if (response.status === 204) return null;

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(result.error || "Something went wrong.");
    error.status = response.status;
    throw error;
  }

  return result;
}

// 401 means "not logged in (anymore)": show the login screen.
// Anything else: tell the user what the server said.
function handleError(error) {
  if (error.status === 401) {
    showAuthScreen("Your session expired. Please log in again.");
    return;
  }
  alert(error.message);
}

// Only one request at a time. This also stops double-clicks.
let busy = false;

async function runAction(action) {
  if (busy) return;
  busy = true;
  try {
    await action();
  } catch (error) {
    handleError(error);
  } finally {
    busy = false;
  }
}

function applyGoal(goal) {
  data.targetMinutes = goal.targetMinutes;
  data.previousAccumulatedMinutes = goal.previousAccumulatedMinutes;
  data.assumedHoursPerDay = goal.assumedHoursPerDay;
}

function normalizeEntry(entry) {
  return {
    id: String(entry.id),
    date: entry.date,
    timeIn: entry.timeIn,
    timeOut: entry.timeOut,
    minutes: entry.minutes,
  };
}

async function loadFromServer() {
  const result = await api("GET", "/tracker");
  applyGoal(result.goal);
  data.entries = result.entries.map(normalizeEntry);
}

// Wipe what's on screen (used on logout / expired session).
function clearLocalData() {
  data.targetMinutes = 0;
  data.previousAccumulatedMinutes = 0;
  data.assumedHoursPerDay = DEFAULT_PACE;
  data.entries = [];
  populateInputsFromState();
  resetLogForm();
  render();
}

// =====================================================
// RENDER (the only place that writes results to the page)
// =====================================================

function render() {
  const stats = getStats();

  // --- progress card ---
  totalTimeAccumulatedContainer.textContent = formatDuration(stats.totalMinutes);
  remainingTimeContainer.textContent = stats.hasTarget
    ? formatDuration(stats.remainingMinutes)
    : "--";
  percentageContainer.textContent = stats.hasTarget ? stats.percentage : "--";

  ringFill.setAttribute(
    "stroke-dashoffset",
    RING_CIRCUMFERENCE * (1 - stats.percentage / 100),
  );
  ring.setAttribute(
    "aria-label",
    stats.hasTarget ? `${stats.percentage}% of your goal` : "No goal set yet",
  );

  if (!stats.hasTarget) {
    statusPill.textContent = "Set a goal";
  } else if (stats.goalReached) {
    statusPill.textContent = "Goal reached";
  } else {
    statusPill.textContent = "In progress";
  }

  // --- looking ahead card ---
  if (!stats.hasTarget) {
    estimateDateContainer.textContent = "--";
    estimateDaysContainer.textContent = "--";
  } else if (stats.goalReached) {
    estimateDateContainer.textContent = "--";
    estimateDaysContainer.textContent = "Goal reached";
  } else {
    estimateDateContainer.textContent = calculateEstDateCompletion(
      stats.daysFromNow,
    );
    estimateDaysContainer.textContent =
      stats.daysFromNow === 1 ? "in 1 day" : `in ${stats.daysFromNow} days`;
  }

  paceInput.value = data.assumedHoursPerDay;

  renderEntries();
}

function renderEntries() {
  const count = data.entries.length;
  entryCount.textContent = count === 1 ? "1 entry" : `${count} entries`;

  if (count === 0) {
    entriesList.innerHTML = `<li class="entries__empty">No entries yet</li>`;
    return;
  }

  // "YYYY-MM-DD HH:MM" strings sort correctly as plain text
  const sorted = [...data.entries].sort((a, b) => {
    const keyA = `${a.date} ${a.timeIn}`;
    const keyB = `${b.date} ${b.timeIn}`;
    return sortSelect.value === "oldest"
      ? keyA.localeCompare(keyB)
      : keyB.localeCompare(keyA);
  });

  entriesList.innerHTML = sorted
    .map(
      (entry) => `
    <li class="entry">
      <span class="entry__icon" aria-hidden="true">${CALENDAR_ICON}</span>
      <div class="entry__info">
        <p class="entry__date">${formatEntryDate(entry.date)}</p>
        <p class="entry__range">${formatClock(entry.timeIn)} — ${formatClock(entry.timeOut)}</p>
      </div>
      <span class="entry__duration">${formatDuration(entry.minutes)}</span>
      <button type="button" class="entry__delete" data-id="${entry.id}" aria-label="Delete entry">${TRASH_ICON}</button>
    </li>`,
    )
    .join("");
}

function updateDurationPreview() {
  const minutes = getDurationMinutes();
  durationHrsContainer.textContent =
    minutes === null ? "--" : formatDuration(minutes);
}

function populateInputsFromState() {
  targetHrsInput.value = data.targetMinutes > 0 ? data.targetMinutes / 60 : "";

  if (data.previousAccumulatedMinutes > 0) {
    const [hours, minutes] = extractHrsAndMins(data.previousAccumulatedMinutes);
    prevHoursInput.value = hours;
    prevMinutesInput.value = minutes;
  } else {
    prevHoursInput.value = "";
    prevMinutesInput.value = "";
  }
}

function resetLogForm() {
  dateInput.value = getTodayString();
  timeInInput.value = DEFAULT_TIME_IN;
  timeOutInput.value = DEFAULT_TIME_OUT;
  updateDurationPreview();
}

// =====================================================
// LOGIN / SIGN UP SCREEN
// The markup lives in index.html and the styles in app.css.
// This part only switches modes and handles the form.
// =====================================================

const authOverlay = document.getElementById("auth-overlay");
const authForm = document.getElementById("auth-form");
const authTitle = document.getElementById("auth-title");
const authSub = document.getElementById("auth-sub");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const authPasswordToggle = document.getElementById("auth-password-toggle");
const authHint = document.getElementById("auth-hint");
const authError = document.getElementById("auth-error");
const authSubmit = document.getElementById("auth-submit");
const authSwitchText = document.getElementById("auth-switch-text");
const authSwitch = document.getElementById("auth-switch");

let authMode = "login"; // "login" or "register"

function setPasswordVisible(visible) {
  authPassword.type = visible ? "text" : "password";
  authPasswordToggle.setAttribute("aria-pressed", String(visible));
  authPasswordToggle.setAttribute(
    "aria-label",
    visible ? "Hide password" : "Show password",
  );
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  authTitle.textContent = isLogin ? "Welcome back" : "Create your account";
  authSub.textContent = isLogin
    ? "Log in to continue tracking your hours."
    : "Sign up to start tracking your hours.";
  authSubmit.textContent = isLogin ? "Log in" : "Create account";
  authSwitchText.textContent = isLogin
    ? "Don’t have an account?"
    : "Already have an account?";
  authSwitch.textContent = isLogin ? "Sign up" : "Log in";
  authPassword.autocomplete = isLogin ? "current-password" : "new-password";
  authHint.hidden = isLogin;
  authError.textContent = "";
  setPasswordVisible(false);
}

authPasswordToggle.addEventListener("click", () => {
  setPasswordVisible(authPassword.type === "password");
});

function showAuthScreen(message = "") {
  clearLocalData(); // don't leave someone's data on screen behind the login box
  authOverlay.hidden = false;
  authError.textContent = message;
  authEmail.focus();
}

function hideAuthScreen() {
  authOverlay.hidden = true;
  setPasswordVisible(false);
}

authSwitch.addEventListener("click", () => {
  setAuthMode(authMode === "login" ? "register" : "login");
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;

  busy = true;
  authSubmit.disabled = true;
  authError.textContent = "";

  try {
    const path = authMode === "login" ? "/auth/login" : "/auth/register";
    await api("POST", path, {
      email: authEmail.value,
      password: authPassword.value,
    });

    authPassword.value = "";
    await loadFromServer();
    populateInputsFromState();
    resetLogForm();
    render();
    hideAuthScreen();
  } catch (error) {
    // For login/register, a 401 just means "wrong email or password"
    authError.textContent = error.message;
  } finally {
    busy = false;
    authSubmit.disabled = false;
  }
});

logoutBtn.addEventListener("click", () => {
  runAction(async () => {
    const choice = confirm('Are you sure you want to logout?')

    if (!choice) {
      return;
    }
    
    await api("POST", "/auth/logout");
    authEmail.value = "";
    authPassword.value = "";
    setAuthMode("login");
    showAuthScreen();
  });
});

// =====================================================
// EVENT HANDLERS
// Each one: validate -> ask the server -> copy its answer -> render
// =====================================================

// Block characters that make no sense in whole-number fields.
document.querySelectorAll("input[data-whole]").forEach((input) => {
  input.addEventListener("keydown", (event) => {
    if ([".", ",", "e", "E", "-", "+"].includes(event.key)) {
      event.preventDefault();
    }
  });
});

// ===== SAVE TARGET HOURS =====
saveTargetHrsBtn.addEventListener("click", () => {
  const targetHours = targetHrsInput.valueAsNumber; // NaN if empty or invalid

  if (
    !Number.isInteger(targetHours) ||
    targetHours < 1 ||
    targetHours > MAX_HOURS
  ) {
    alert(`Enter a whole number of hours from 1 to ${MAX_HOURS}.`);
    return;
  }

  runAction(async () => {
    const result = await api("PATCH", "/goal", {
      targetMinutes: targetHours * 60,
    });
    applyGoal(result.goal);
    render();
  });
});

// ===== SAVE PREVIOUSLY ACCUMULATED TIME =====
savePrevHrsBtn.addEventListener("click", () => {
  const hours = readWholeNumber(prevHoursInput);
  const minutes = readWholeNumber(prevMinutesInput);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > MAX_HOURS ||
    minutes < 0 ||
    minutes > 59
  ) {
    alert("Enter valid hours and minutes (minutes from 0 to 59).");
    return;
  }

  // A single value that REPLACES the old one, so clicking twice
  // can never double count.
  runAction(async () => {
    const result = await api("PATCH", "/goal", {
      previousAccumulatedMinutes: hours * 60 + minutes,
    });
    applyGoal(result.goal);
    render();
  });
});

// ===== PACE (assumed hours per day) =====
stepperButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const change = button.id === "pace-plus" ? 1 : -1;
    const next = data.assumedHoursPerDay + change;

    if (next < 1 || next > MAX_PACE) return;

    runAction(async () => {
      const result = await api("PATCH", "/goal", { assumedHoursPerDay: next });
      applyGoal(result.goal);
      render();
    });
  });
});

paceInput.addEventListener("change", async () => {
  const value = paceInput.valueAsNumber;

  if (!Number.isInteger(value) || value < 1 || value > MAX_PACE) {
    alert(`Hours per day must be a whole number from 1 to ${MAX_PACE}.`);
    paceInput.value = data.assumedHoursPerDay; // put the old value back
    return;
  }

  await runAction(async () => {
    const result = await api("PATCH", "/goal", { assumedHoursPerDay: value });
    applyGoal(result.goal);
    render();
  });

  // if the request failed, show the value the server still has
  paceInput.value = data.assumedHoursPerDay;
});

// ===== LOG ENTRY =====
timeInInput.addEventListener("input", updateDurationPreview);
timeOutInput.addEventListener("input", updateDurationPreview);

logEntryBtn.addEventListener("click", () => {
  const date = dateInput.value;
  const timeIn = timeInInput.value;
  const timeOut = timeOutInput.value;

  if (!date) {
    alert("Pick a date.");
    return;
  }

  if (date > getTodayString()) {
    alert("You can't log time for a future date.");
    return;
  }

  if (!timeIn || !timeOut) {
    alert("Fill in both time in and time out.");
    return;
  }

  const minutes = getDurationMinutes();

  if (minutes === null) {
    alert("Time out must be later than time in.");
    return;
  }

  // Quick overlap check for instant feedback. The server checks again,
  // and that check is the one that can't be raced.
  // Back-to-back entries (12:00 end, 12:00 start) are allowed.
  const newIn = timeToMinutes(timeIn);
  const newOut = timeToMinutes(timeOut);

  const overlaps = data.entries.some(
    (entry) =>
      entry.date === date &&
      newIn < timeToMinutes(entry.timeOut) &&
      newOut > timeToMinutes(entry.timeIn),
  );

  if (overlaps) {
    alert("This overlaps an entry you already logged for that date.");
    return;
  }

  runAction(async () => {
    const result = await api("POST", "/entries", { date, timeIn, timeOut });
    data.entries.push(normalizeEntry(result.entry));
    render();
  });
});

// ===== DELETE ENTRY (one listener for the whole list) =====
entriesList.addEventListener("click", (event) => {
  const button = event.target.closest(".entry__delete");
  if (!button) return;

  if (!confirm("Delete this entry?")) return;

  const id = button.dataset.id;

  runAction(async () => {
    await api("DELETE", `/entries/${id}`);
    data.entries = data.entries.filter((entry) => entry.id !== id);
    render();
  });
});

// ===== SORT =====
sortSelect.addEventListener("change", renderEntries);

// ===== RESET =====
// The server archives the current goal (history is kept) and starts a new one.
resetBtn.addEventListener("click", () => {
  if (!confirm("Are you sure? This starts a fresh goal.")) return;

  runAction(async () => {
    const result = await api("POST", "/goal/reset");
    applyGoal(result.goal);
    data.entries = [];
    populateInputsFromState();
    resetLogForm();
    render();
  });
});

// =====================================================
// START UP
// =====================================================
dateInput.max = getTodayString(); // no future dates, past dates are allowed
resetLogForm();
render(); // empty screen until the server answers

(async function start() {
  try {
    await loadFromServer();
    populateInputsFromState();
    render();
  } catch (error) {
    if (error.status === 401) {
      showAuthScreen(); // not logged in yet: show the login box
    } else {
      alert(error.message);
    }
  }
})();