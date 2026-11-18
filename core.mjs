export const MAX_AMOUNT = 100000000;

export function isValidDate(date) {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00`));
}

export function normalizeTransaction(item) {
  if (!item || typeof item.id !== "string" || typeof item.description !== "string" || !item.description.trim() ||
    typeof item.amount !== "number" || !Number.isFinite(item.amount) || item.amount <= 0 || item.amount > MAX_AMOUNT ||
    !["income", "expense"].includes(item.type) || typeof item.category !== "string" || !item.category.trim() || !isValidDate(item.date)) return null;
  const recurring = item.recurring && ["weekly", "monthly"].includes(item.recurring.frequency)
    ? { frequency: item.recurring.frequency, lastGenerated: isValidDate(item.recurring.lastGenerated) ? item.recurring.lastGenerated : item.date }
    : null;
  return { ...item, description: item.description.trim(), category: item.category.trim(), recurring, parentRecurringId: typeof item.parentRecurringId === "string" ? item.parentRecurringId : null };
}

export function advanceDate(date, frequency) {
  const source = new Date(`${date}T00:00:00`);
  if (frequency === "weekly") source.setDate(source.getDate() + 7);
  else {
    const day = source.getDate();
    source.setDate(1);
    source.setMonth(source.getMonth() + 1);
    source.setDate(Math.min(day, new Date(source.getFullYear(), source.getMonth() + 1, 0).getDate()));
  }
  return source.toLocaleDateString("en-CA");
}

export function migrateBackup(parsed) {
  const version = Array.isArray(parsed) ? 1 : Number(parsed?.version || 1);
  const rawTransactions = Array.isArray(parsed) ? parsed : parsed?.transactions;
  if (!Array.isArray(rawTransactions)) throw new Error("Transactions are missing");
  const transactions = rawTransactions.map(normalizeTransaction);
  if (transactions.some(item => !item)) throw new Error("Invalid transaction");
  const budget = Number(Array.isArray(parsed) ? 0 : parsed.monthlyBudget || 0);
  if (!Number.isFinite(budget) || budget < 0 || budget > MAX_AMOUNT) throw new Error("Invalid budget");
  const categories = Array.isArray(parsed?.customCategories) ? parsed.customCategories.filter(name => typeof name === "string" && name.trim() && name.trim().length <= 30).map(name => name.trim()) : [];
  const categoryBudgets = parsed?.categoryBudgets && typeof parsed.categoryBudgets === "object"
    ? Object.fromEntries(Object.entries(parsed.categoryBudgets).filter(([name, value]) => typeof name === "string" && Number.isFinite(value) && value >= 0 && value <= MAX_AMOUNT)) : {};
  return { sourceVersion: version, transactions, monthlyBudget: Math.round(budget * 100) / 100, customCategories: [...new Set(categories)], categoryBudgets };
}

export function pageItems(items, page, pageSize) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  return { items: items.slice((safePage - 1) * pageSize, safePage * pageSize), page: safePage, pageCount };
}
