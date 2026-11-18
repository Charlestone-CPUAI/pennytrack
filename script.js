import { advanceDate, migrateBackup, normalizeTransaction, pageItems } from "./core.mjs";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const STORAGE = { transactions: "pennytrack-transactions", budget: "pennytrack-budget", categories: "pennytrack-categories", categoryBudgets: "pennytrack-category-budgets" };
const CLOUD_USER_KEY = "pennytrack-cloud-user";
const supabase = createClient("https://gswlxtiwclztionmyfcd.supabase.co", "sb_publishable_qfruHSM7VJ82Igo3Ldj_8g_ZFpQRoS8");
const defaultCategories = ["Salary", "Food", "Transportation", "Shopping", "Bills", "Entertainment", "Education", "Other"];
const form = document.getElementById("transaction-form");
const transactionList = document.getElementById("transaction-list");
const reportMonth = document.getElementById("report-month");
const peso = amount => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount);
const localDate = date => new Date(date).toLocaleDateString("en-CA");
const today = localDate(new Date());
let storageWarning = "";
let transactions = loadTransactions();
let monthlyBudget = loadNumber(STORAGE.budget);
let customCategories = loadCategories();
let categoryBudgets = loadCategoryBudgets();
let expenseChart = null;
let trendChart = null;
let currentPage = 1;
const pageSize = 10;
let currentUser = null;
let cloudSaveTimer = null;
let isLoadingCloudState = false;

function loadNumber(key) { try { const value = Number(localStorage.getItem(key)); return Number.isFinite(value) && value >= 0 && value <= 100000000 ? value : 0; } catch { preserveCorruptData(key, localStorage.getItem(key) || ""); return 0; } }
function preserveCorruptData(key, raw) {
  try { localStorage.setItem(`pennytrack-recovery-${key}-${Date.now()}`, raw); } catch { /* Storage may be unavailable. */ }
  storageWarning = "Saved data could not be read. A recovery copy was kept when possible.";
}
function loadTransactions() { try { const raw = localStorage.getItem(STORAGE.transactions) || "[]"; const saved = JSON.parse(raw); return Array.isArray(saved) ? saved.map(normalizeTransaction).filter(Boolean) : []; } catch { preserveCorruptData(STORAGE.transactions, localStorage.getItem(STORAGE.transactions) || ""); return []; } }
function loadCategories() { try { const saved = JSON.parse(localStorage.getItem(STORAGE.categories) || "[]"); return Array.isArray(saved) ? [...new Set(saved.filter(name => typeof name === "string" && name.trim() && name.trim().length <= 30).map(name => name.trim()))] : []; } catch { preserveCorruptData(STORAGE.categories, localStorage.getItem(STORAGE.categories) || ""); return []; } }
function loadCategoryBudgets() { try { const saved = JSON.parse(localStorage.getItem(STORAGE.categoryBudgets) || "{}"); return saved && typeof saved === "object" ? Object.fromEntries(Object.entries(saved).filter(([name, value]) => typeof name === "string" && Number.isFinite(value) && value >= 0 && value <= 100000000)) : {}; } catch { preserveCorruptData(STORAGE.categoryBudgets, localStorage.getItem(STORAGE.categoryBudgets) || ""); return {}; } }
function saveState() {
  localStorage.setItem(STORAGE.transactions, JSON.stringify(transactions)); localStorage.setItem(STORAGE.budget, String(monthlyBudget)); localStorage.setItem(STORAGE.categories, JSON.stringify(customCategories)); localStorage.setItem(STORAGE.categoryBudgets, JSON.stringify(categoryBudgets));
  if (currentUser && !isLoadingCloudState) queueCloudSave();
}
function localState() { return { transactions, monthlyBudget, customCategories, categoryBudgets }; }
function applyState(state) {
  transactions = Array.isArray(state.transactions) ? state.transactions.map(normalizeTransaction).filter(Boolean) : [];
  monthlyBudget = Number.isFinite(Number(state.monthlyBudget)) ? Number(state.monthlyBudget) : 0;
  customCategories = Array.isArray(state.customCategories) ? [...new Set(state.customCategories.filter(name => typeof name === "string" && name.trim() && name.trim().length <= 30).map(name => name.trim()))] : [];
  categoryBudgets = state.categoryBudgets && typeof state.categoryBudgets === "object" ? Object.fromEntries(Object.entries(state.categoryBudgets).filter(([name, value]) => typeof name === "string" && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100000000)) : {};
}
function queueCloudSave() {
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => { saveCloudState(); }, 400);
}
async function saveCloudState() {
  if (!currentUser || isLoadingCloudState) return;
  const state = localState();
  const { error } = await supabase.from("app_state").upsert({
    user_id: currentUser.id,
    transactions: state.transactions,
    monthly_budget: state.monthlyBudget,
    custom_categories: state.customCategories,
    category_budgets: state.categoryBudgets
  }, { onConflict: "user_id" });
  if (error) setDataStatus(`Cloud sync failed: ${error.message}`);
  else setDataStatus("Saved to cloud.");
}
async function ensureProfile(user) {
  const displayName = user.user_metadata?.display_name || user.email?.split("@")[0] || "PennyTrack user";
  const { error } = await supabase.from("app_users").upsert({ id: user.id, display_name: displayName }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw error;
}
async function loadCloudState() {
  if (!currentUser) return;
  isLoadingCloudState = true;
  try {
    await ensureProfile(currentUser);
    const { data, error } = await supabase.from("app_state").select("transactions, monthly_budget, custom_categories, category_budgets").eq("user_id", currentUser.id).maybeSingle();
    if (error) throw error;
    if (data) {
      applyState({ transactions: data.transactions, monthlyBudget: Number(data.monthly_budget), customCategories: data.custom_categories, categoryBudgets: data.category_budgets });
      saveState();
      setDataStatus("Cloud data loaded.");
    } else {
      if (localStorage.getItem(CLOUD_USER_KEY) && localStorage.getItem(CLOUD_USER_KEY) !== currentUser.id) applyState({ transactions: [], monthlyBudget: 0, customCategories: [], categoryBudgets: {} });
      isLoadingCloudState = false;
      await saveCloudState();
      setDataStatus("Cloud account ready.");
    }
    localStorage.setItem(CLOUD_USER_KEY, currentUser.id);
  } catch (error) {
    setDataStatus(`Cloud sync unavailable: ${error.message}`);
  } finally {
    isLoadingCloudState = false;
  }
}
function allCategories() { return [...new Set([...defaultCategories, ...customCategories, ...transactions.map(item => item.category)])].sort((a, b) => a.localeCompare(b)); }

function updateCategorySelects() {
  const categories = allCategories();
  [document.getElementById("category"), document.getElementById("edit-category"), document.getElementById("category-budget-category")].forEach(select => {
    const selected = select.value;
    select.replaceChildren(...categories.map(name => { const option = document.createElement("option"); option.value = name; option.textContent = name; return option; }));
    if (categories.includes(selected)) select.value = selected;
  });
}
function monthLabel(month) { return new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00`)); }
function transactionsForPeriod() { return transactions.filter(item => item.date.startsWith(reportMonth.value)); }
function processRecurringTransactions() {
  let changed = false;
  transactions.filter(item => item.recurring && !item.parentRecurringId).forEach(item => {
    let nextDate = advanceDate(item.recurring.lastGenerated || item.date, item.recurring.frequency);
    while (nextDate <= today) { transactions.push({ ...item, id: crypto.randomUUID(), date: nextDate, recurring: null, parentRecurringId: item.id }); item.recurring.lastGenerated = nextDate; nextDate = advanceDate(nextDate, item.recurring.frequency); changed = true; }
  });
  if (changed) saveState();
}

function renderTransactions() {
  const search = document.getElementById("search-transactions").value.trim().toLowerCase();
  const type = document.getElementById("filter-transactions").value;
  const periodTransactions = transactionsForPeriod();
  const filtered = periodTransactions.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).filter(item => (item.description.toLowerCase().includes(search) || item.category.toLowerCase().includes(search)) && (type === "all" || item.type === type));
  const paged = pageItems(filtered, currentPage, pageSize);
  currentPage = paged.page;
  transactionList.replaceChildren();
  const empty = document.getElementById("empty-message"); empty.style.display = filtered.length ? "none" : "block"; empty.textContent = periodTransactions.length ? "No matching transactions found." : "No transactions for this period.";
  paged.items.forEach(item => {
    const row = document.createElement("tr");
    const action = document.createElement("td"); const buttons = document.createElement("div"); buttons.className = "action-buttons";
    const edit = document.createElement("button"); edit.type = "button"; edit.className = "edit-btn"; edit.textContent = "Edit"; edit.setAttribute("aria-label", `Edit ${item.description}`); edit.onclick = () => openEditModal(item.id);
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "delete-btn"; remove.textContent = "Delete"; remove.setAttribute("aria-label", `Delete ${item.description}`); remove.onclick = () => deleteTransaction(item.id);
    buttons.append(edit, remove); action.append(buttons);
    const recurring = item.recurring || item.parentRecurringId ? " ↻" : "";
    [item.description + recurring, item.category, item.date, `${item.type === "income" ? "+" : "-"}${peso(item.amount)}`].forEach((value, index) => { const cell = document.createElement("td"); cell.textContent = value; if (index === 3) cell.className = item.type === "income" ? "amount-income" : "amount-expense"; row.append(cell); });
    row.append(action); transactionList.append(row);
  });
  document.getElementById("page-status").textContent = `Page ${paged.page} of ${paged.pageCount}`;
  document.getElementById("previous-page").disabled = paged.page === 1;
  document.getElementById("next-page").disabled = paged.page === paged.pageCount;
}

function updateDashboard() {
  const periodTransactions = transactionsForPeriod();
  const income = periodTransactions.filter(item => item.type === "income").reduce((sum, item) => sum + item.amount, 0);
  const expenses = periodTransactions.filter(item => item.type === "expense").reduce((sum, item) => sum + item.amount, 0);
  document.getElementById("balance").textContent = peso(income - expenses); document.getElementById("income").textContent = peso(income); document.getElementById("expense").textContent = peso(expenses); document.getElementById("transaction-count").textContent = `${periodTransactions.length} records`; document.getElementById("report-period-label").textContent = monthLabel(reportMonth.value);
  updateBudget(expenses); renderTransactions(); updateCharts(periodTransactions); updateAnalytics(income, expenses); renderCategoryBudgets();
}
function updateBudget(expenses) {
  const remaining = monthlyBudget - expenses; const percentage = monthlyBudget ? (expenses / monthlyBudget) * 100 : 0;
  document.getElementById("budget-total").textContent = peso(monthlyBudget); document.getElementById("budget-spent").textContent = peso(expenses); document.getElementById("budget-remaining").textContent = peso(remaining); document.getElementById("budget-percentage").textContent = `${percentage.toFixed(1)}%`;
  const progress = document.getElementById("budget-progress-bar"); progress.style.width = `${Math.min(percentage, 100)}%`;
  const message = document.getElementById("budget-message");
  if (!monthlyBudget) { message.textContent = "Set your budget to start tracking."; progress.style.background = "#969bad"; }
  else if (percentage >= 100) { message.textContent = "Warning! You've exceeded your monthly budget."; progress.style.background = "#ff7185"; }
  else if (percentage >= 80) { message.textContent = "Careful! You're getting close to your budget limit."; progress.style.background = "#ffbd69"; }
  else { message.textContent = "Great job! You're staying within your budget."; progress.style.background = "#35d39a"; }
}

function chartOptions(position) { return { responsive: true, maintainAspectRatio: false, plugins: { legend: { position, labels: { color: "#c3c7d5", usePointStyle: true } } }, scales: position === "top" ? { x: { ticks: { color: "#c3c7d5" }, grid: { color: "#2b3042" } }, y: { ticks: { color: "#c3c7d5" }, grid: { color: "#2b3042" } } } : undefined }; }
function totalForMonth(month, type) { return transactions.filter(item => item.date.startsWith(month) && item.type === type).reduce((sum, item) => sum + item.amount, 0); }
function updateCharts(periodTransactions) {
  const categories = {};
  periodTransactions.filter(item => item.type === "expense").forEach(item => { categories[item.category] = (categories[item.category] || 0) + item.amount; });
  const expenseEmpty = document.getElementById("expense-chart-empty");
  const trendEmpty = document.getElementById("trend-chart-empty");
  if (typeof Chart === "undefined") {
    expenseEmpty.hidden = false; trendEmpty.hidden = false;
    expenseEmpty.textContent = "Charts are unavailable. Check your internet connection and reload.";
    trendEmpty.textContent = "Charts are unavailable. Check your internet connection and reload.";
    return;
  }
  expenseEmpty.hidden = Object.keys(categories).length > 0;
  if (expenseChart) expenseChart.destroy();
  expenseChart = new Chart(document.getElementById("expenseChart"), { type: "doughnut", data: { labels: Object.keys(categories), datasets: [{ data: Object.values(categories), backgroundColor: ["#9275ff", "#35d39a", "#ff7185", "#ffbd69", "#50b9ed", "#e879f9", "#a3e635", "#94a3b8"], borderWidth: 0 }] }, options: chartOptions("bottom") });
  const months = Array.from({ length: 6 }, (_, index) => { const date = new Date(`${reportMonth.value}-01T00:00:00`); date.setMonth(date.getMonth() - (5 - index)); return localDate(date).slice(0, 7); });
  const hasTrendData = months.some(month => totalForMonth(month, "income") || totalForMonth(month, "expense"));
  trendEmpty.hidden = hasTrendData;
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(document.getElementById("trendChart"), { type: "line", data: { labels: months.map(month => monthLabel(month).slice(0, 3)), datasets: [{ label: "Income", data: months.map(month => totalForMonth(month, "income")), borderColor: "#35d39a", tension: .3 }, { label: "Expenses", data: months.map(month => totalForMonth(month, "expense")), borderColor: "#ff7185", tension: .3 }] }, options: chartOptions("top") });
}
function updateAnalytics(income, expenses) {
  const categoryTotals = {};
  transactionsForPeriod().filter(item => item.type === "expense").forEach(item => { categoryTotals[item.category] = (categoryTotals[item.category] || 0) + item.amount; });
  const top = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0];
  const previous = new Date(`${reportMonth.value}-01T00:00:00`); previous.setMonth(previous.getMonth() - 1); const previousExpenses = totalForMonth(localDate(previous).slice(0, 7), "expense");
  document.getElementById("savings-rate").textContent = income ? `${(((income - expenses) / income) * 100).toFixed(1)}%` : "—";
  document.getElementById("top-category").textContent = top ? `${top[0]} (${peso(top[1])})` : "—";
  document.getElementById("expense-change").textContent = previousExpenses ? `${(((expenses - previousExpenses) / previousExpenses) * 100).toFixed(1)}%` : expenses ? "New" : "—";
}
function renderCategoryBudgets() {
  const list = document.getElementById("category-budget-list"); list.replaceChildren(); const currentExpenses = transactionsForPeriod().filter(item => item.type === "expense"); const entries = Object.entries(categoryBudgets).filter(([, budget]) => budget > 0);
  if (!entries.length) { list.textContent = "No category limits set yet."; return; }
  entries.forEach(([category, budget]) => { const spent = currentExpenses.filter(item => item.category === category).reduce((sum, item) => sum + item.amount, 0); const item = document.createElement("div"); item.className = "category-budget-item"; const text = document.createElement("span"); text.textContent = `${category}: ${peso(spent)} / ${peso(budget)}`; const remove = document.createElement("button"); remove.type = "button"; remove.className = "delete-btn"; remove.textContent = "Remove"; remove.onclick = () => { delete categoryBudgets[category]; saveState(); updateDashboard(); }; item.append(text, remove); list.append(item); });
}

function setDataStatus(message) { document.getElementById("data-status").textContent = message; const toast = document.getElementById("toast"); toast.textContent = message; toast.classList.add("is-visible"); clearTimeout(setDataStatus.timeout); setDataStatus.timeout = setTimeout(() => toast.classList.remove("is-visible"), 3500); }
function confirmAction(message, actionLabel = "Continue") {
  const dialog = document.getElementById("confirmation-modal");
  document.getElementById("confirmation-message").textContent = message;
  const accept = document.getElementById("accept-confirmation"); accept.textContent = actionLabel;
  dialog.showModal();
  return new Promise(resolve => {
    const finish = approved => { dialog.close(); accept.removeEventListener("click", approve); document.getElementById("cancel-confirmation").removeEventListener("click", cancel); resolve(approved); };
    const approve = () => finish(true); const cancel = () => finish(false);
    accept.addEventListener("click", approve); document.getElementById("cancel-confirmation").addEventListener("click", cancel);
  });
}
function toggleRecurrence(prefix = "") { const isEdit = prefix === "edit"; document.getElementById(isEdit ? "edit-recurrence-options" : "recurrence-options").hidden = !document.getElementById(isEdit ? "edit-is-recurring" : "is-recurring").checked; }
function addTransaction(event) {
  event.preventDefault();
  const item = normalizeTransaction({ id: crypto.randomUUID(), description: document.getElementById("description").value, amount: Number(document.getElementById("amount").value), type: document.getElementById("type").value, category: document.getElementById("category").value, date: document.getElementById("date").value, recurring: document.getElementById("is-recurring").checked ? { frequency: document.getElementById("recurrence-frequency").value, lastGenerated: document.getElementById("date").value } : null });
  if (!item) return setDataStatus("Please enter valid transaction details.");
  item.amount = Math.round(item.amount * 100) / 100; transactions.push(item); saveState(); form.reset(); document.getElementById("date").value = today; updateDashboard(); setDataStatus("Transaction added.");
}
async function deleteTransaction(id) { if (await confirmAction("Delete this transaction? This cannot be undone.", "Delete")) { transactions = transactions.filter(item => item.id !== id); saveState(); updateDashboard(); setDataStatus("Transaction deleted."); } }
function openEditModal(id) {
  const item = transactions.find(transaction => transaction.id === id); if (!item) return;
  updateCategorySelects(); document.getElementById("edit-id").value = id; document.getElementById("edit-description").value = item.description; document.getElementById("edit-amount").value = item.amount; document.getElementById("edit-type").value = item.type; document.getElementById("edit-category").value = item.category; document.getElementById("edit-date").value = item.date;
  document.getElementById("edit-is-recurring").checked = Boolean(item.recurring); document.getElementById("edit-recurrence-frequency").value = item.recurring?.frequency || "monthly"; toggleRecurrence("edit"); document.getElementById("edit-transaction-modal").showModal();
}
function saveEdit(event) {
  event.preventDefault(); const id = document.getElementById("edit-id").value; const index = transactions.findIndex(item => item.id === id); if (index < 0) return;
  const old = transactions[index]; const updated = normalizeTransaction({ ...old, description: document.getElementById("edit-description").value, amount: Number(document.getElementById("edit-amount").value), type: document.getElementById("edit-type").value, category: document.getElementById("edit-category").value, date: document.getElementById("edit-date").value, recurring: document.getElementById("edit-is-recurring").checked ? { frequency: document.getElementById("edit-recurrence-frequency").value, lastGenerated: old.recurring?.lastGenerated || document.getElementById("edit-date").value } : null });
  if (!updated) return setDataStatus("Please enter valid transaction details.");
  updated.amount = Math.round(updated.amount * 100) / 100; transactions[index] = updated; saveState(); document.getElementById("edit-transaction-modal").close(); updateDashboard(); setDataStatus("Transaction updated.");
}
function addCategory() { const input = document.getElementById("new-category"); const name = input.value.trim(); if (!name || name.length > 30) return setDataStatus("Enter a category name up to 30 characters."); if (!allCategories().some(category => category.toLowerCase() === name.toLowerCase())) customCategories.push(name); input.value = ""; saveState(); updateCategorySelects(); setDataStatus("Category saved."); }
function saveCategoryBudget() { const category = document.getElementById("category-budget-category").value; const amount = Number(document.getElementById("category-budget-amount").value); if (!category || !Number.isFinite(amount) || amount < 0 || amount > 100000000) return setDataStatus("Enter a valid category budget."); if (amount === 0) delete categoryBudgets[category]; else categoryBudgets[category] = Math.round(amount * 100) / 100; document.getElementById("category-budget-amount").value = ""; saveState(); updateDashboard(); setDataStatus("Category budget saved."); }

function downloadFile(filename, content, type) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement("a"); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url); }
function exportBackup() { downloadFile(`pennytrack-backup-${today}.json`, JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), transactions, monthlyBudget, customCategories, categoryBudgets }, null, 2), "application/json"); setDataStatus("Backup downloaded successfully."); }
function escapeCsvValue(value) { const text = String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function exportCsv() { const rows = [["Description", "Category", "Type", "Amount", "Date", "Recurring"], ...transactions.map(item => [item.description, item.category, item.type, item.amount, item.date, item.recurring?.frequency || ""])]; downloadFile(`pennytrack-transactions-${today}.csv`, `\uFEFF${rows.map(row => row.map(escapeCsvValue).join(",")).join("\n")}`, "text/csv;charset=utf-8"); setDataStatus("CSV downloaded successfully."); }
function importBackup(event) {
  const file = event.target.files[0]; if (!file) return; const reader = new FileReader();
  reader.onload = async () => { try {
    const migrated = migrateBackup(JSON.parse(reader.result));
    if (!await confirmAction(`Import version ${migrated.sourceVersion} backup? It will replace your current transactions and settings.`, "Import")) return;
    transactions = migrated.transactions; monthlyBudget = migrated.monthlyBudget; customCategories = migrated.customCategories; categoryBudgets = migrated.categoryBudgets; saveState(); initializeUI(); setDataStatus("Backup imported successfully.");
  } catch { setDataStatus("That file is not a valid PennyTrack backup."); } finally { event.target.value = ""; } };
  reader.readAsText(file);
}
async function clearAllData() { if (await confirmAction("A backup will download before all transactions, categories, and budgets are cleared.", "Back up and clear")) { exportBackup(); transactions = []; monthlyBudget = 0; customCategories = []; categoryBudgets = {}; saveState(); initializeUI(); setDataStatus("Backup downloaded and cloud data cleared."); } }
function initializeUI() { reportMonth.value ||= today.slice(0, 7); document.getElementById("date").value ||= today; document.getElementById("monthly-budget").value = monthlyBudget || ""; updateCategorySelects(); processRecurringTransactions(); updateDashboard(); if (storageWarning) setDataStatus(storageWarning); }
function setAppEnabled(enabled) {
  document.querySelectorAll("main input, main select, main button").forEach(control => { control.disabled = !enabled; });
}
function updateAccountUI() {
  const signedIn = Boolean(currentUser);
  document.getElementById("auth-form").hidden = signedIn;
  document.getElementById("signed-in-controls").hidden = !signedIn;
  document.getElementById("account-email").textContent = currentUser?.email || "";
  document.getElementById("auth-status").textContent = signedIn ? "Cloud sync is enabled." : "Sign in to access your cloud data.";
  setAppEnabled(signedIn);
}
async function handleSession(session) {
  const nextUser = session?.user || null;
  if (nextUser?.id === currentUser?.id && Boolean(nextUser) === Boolean(currentUser)) return;
  currentUser = nextUser;
  updateAccountUI();
  if (!currentUser) { applyState({ transactions: [], monthlyBudget: 0, customCategories: [], categoryBudgets: {} }); initializeUI(); return; }
  await loadCloudState();
  initializeUI();
}
async function signIn(event) {
  event.preventDefault();
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) document.getElementById("auth-status").textContent = error.message;
}
async function signUp() {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  if (!email || password.length < 6) { document.getElementById("auth-status").textContent = "Enter an email and a password of at least 6 characters."; return; }
  const { data, error } = await supabase.auth.signUp({ email, password });
  document.getElementById("auth-status").textContent = error ? error.message : data.session ? "Account created and signed in." : "Check your email to confirm your account, then sign in.";
}

form.addEventListener("submit", addTransaction);
document.getElementById("save-budget").addEventListener("click", () => { const value = Number(document.getElementById("monthly-budget").value); if (!Number.isFinite(value) || value <= 0 || value > 100000000) return setDataStatus("Please enter a valid budget amount."); monthlyBudget = Math.round(value * 100) / 100; saveState(); updateDashboard(); setDataStatus("Monthly budget saved."); });
document.getElementById("search-transactions").addEventListener("input", () => { currentPage = 1; renderTransactions(); });
document.getElementById("filter-transactions").addEventListener("change", () => { currentPage = 1; renderTransactions(); });
reportMonth.addEventListener("change", () => { currentPage = 1; updateDashboard(); });
document.getElementById("previous-page").addEventListener("click", () => { currentPage--; renderTransactions(); });
document.getElementById("next-page").addEventListener("click", () => { currentPage++; renderTransactions(); });
document.getElementById("is-recurring").addEventListener("change", () => toggleRecurrence());
document.getElementById("edit-is-recurring").addEventListener("change", () => toggleRecurrence("edit"));
document.getElementById("edit-transaction-form").addEventListener("submit", saveEdit);
["close-edit-modal", "cancel-edit"].forEach(id => document.getElementById(id).addEventListener("click", () => document.getElementById("edit-transaction-modal").close()));
document.getElementById("add-category").addEventListener("click", addCategory);
document.getElementById("save-category-budget").addEventListener("click", saveCategoryBudget);
document.getElementById("export-json").addEventListener("click", exportBackup);
document.getElementById("export-csv").addEventListener("click", exportCsv);
document.getElementById("import-file").addEventListener("change", importBackup);
document.getElementById("clear-data").addEventListener("click", clearAllData);
document.getElementById("auth-form").addEventListener("submit", signIn);
document.getElementById("sign-up").addEventListener("click", signUp);
document.getElementById("sign-out").addEventListener("click", () => supabase.auth.signOut());
supabase.auth.onAuthStateChange((_event, session) => { handleSession(session); });
setAppEnabled(false);
const { data: { session } } = await supabase.auth.getSession();
handleSession(session);
