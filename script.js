
const form = document.getElementById("transaction-form");
const transactionList = document.getElementById("transaction-list");

const balanceDisplay = document.getElementById("balance");
const incomeDisplay = document.getElementById("income");
const expenseDisplay = document.getElementById("expense");

const emptyMessage = document.getElementById("empty-message");
const transactionCount = document.getElementById("transaction-count");

let transactions = [];

try {
  const saved = JSON.parse(
    localStorage.getItem("pennytrack-transactions") || "[]"
  );

  if (Array.isArray(saved)) {
    transactions = saved.filter(item =>
      item &&
      typeof item.id === "string" &&
      typeof item.description === "string" &&
      typeof item.amount === "number" &&
      Number.isFinite(item.amount) &&
      item.amount > 0 &&
      item.amount <= 100000000 &&
      ["income", "expense"].includes(item.type) &&
      typeof item.category === "string" &&
      typeof item.date === "string"
    );
  }
} catch (error) {
  console.error("Unable to load saved transactions:", error);
}

const peso = amount =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP"
  }).format(amount);

const today = new Date().toLocaleDateString("en-CA");
document.getElementById("date").value = today;

let expenseChart = null;

function saveTransactions() {
  localStorage.setItem(
    "pennytrack-transactions",
    JSON.stringify(transactions)
  );
}

function updateDashboard() {
  const income = transactions
    .filter(item => item.type === "income")
    .reduce((total, item) => total + item.amount, 0);

  const expenses = transactions
    .filter(item => item.type === "expense")
    .reduce((total, item) => total + item.amount, 0);

  balanceDisplay.textContent = peso(income - expenses);
  incomeDisplay.textContent = peso(income);
  expenseDisplay.textContent = peso(expenses);

  transactionCount.textContent =
    `${transactions.length} records`;

  renderTransactions();
  updateChart();
}


function renderTransactions() {
  transactionList.innerHTML = "";

  const searchTerm = document
    .getElementById("search-transactions")
    .value.trim().toLowerCase();

  const filterType = document
    .getElementById("filter-transactions")
    .value;

  emptyMessage.style.display = "none";

  const sorted = [...transactions]
    .sort((a, b) =>
      b.date.localeCompare(a.date) ||
      b.id.localeCompare(a.id)
    );

  const filtered = sorted.filter(item => {
    const matchesSearch =
      item.description.toLowerCase().includes(searchTerm) ||
      item.category.toLowerCase().includes(searchTerm);

    const matchesType =
      filterType === "all" || item.type === filterType;

    return matchesSearch && matchesType;
  });

  if (filtered.length === 0) {
    emptyMessage.style.display = "block";

    emptyMessage.textContent =
      transactions.length === 0
        ? "No transactions yet. Add your first transaction!"
        : "No matching transactions found.";

  }

  filtered.forEach(item => {
    const row = document.createElement("tr");

    const description = document.createElement("td");
    description.textContent = item.description;

    const category = document.createElement("td");
    category.textContent = item.category;

    const date = document.createElement("td");
    date.textContent = item.date;

    const amount = document.createElement("td");

    amount.textContent =
      `${item.type === "income" ? "+" : "-"}${peso(item.amount)}`;

    amount.className =
      item.type === "income"
        ? "amount-income"
        : "amount-expense";

    const action = document.createElement("td");

    const buttons = document.createElement("div");
    buttons.className = "action-buttons";

    const editButton = document.createElement("button");

    editButton.textContent = "Edit";
    editButton.className = "edit-btn";
    editButton.type = "button";

    editButton.addEventListener("click", () => {
      editTransaction(item.id);
    });

    const deleteButton = document.createElement("button");

    deleteButton.textContent = "Delete";
    deleteButton.className = "delete-btn";
    deleteButton.type = "button";

    deleteButton.addEventListener("click", () => {
      deleteTransaction(item.id);
    });

    buttons.append(editButton, deleteButton);
    action.appendChild(buttons);

    row.append(description, category, date, amount, action);

    transactionList.appendChild(row);
  });
}


function addTransaction(event) {
  event.preventDefault();

  const description =
    document.getElementById("description").value.trim();

  const amount =
    Number(document.getElementById("amount").value);

  const type =
    document.getElementById("type").value;

  const category =
    document.getElementById("category").value;

  const date =
    document.getElementById("date").value;

  if (
    !description ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > 100000000 ||
    !["income", "expense"].includes(type) ||
    !date ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(date + "T00:00:00"))
  ) {
    alert("Please enter valid transaction details.");
    return;
  }

  const transaction = {
    id: crypto.randomUUID(),
    description,
    amount: Math.round(amount * 100) / 100,
    type,
    category,
    date
  };

  transactions.push(transaction);

  saveTransactions();
  updateDashboard();

  form.reset();
  document.getElementById("date").value = today;
}

function deleteTransaction(id) {
  const confirmed = confirm(
    "Are you sure you want to delete this transaction?"
  );

  if (!confirmed) return;

  transactions = transactions.filter(
    item => item.id !== id
  );

  saveTransactions();
  updateDashboard();
}

function updateChart() {
  const expenses = transactions.filter(
    item => item.type === "expense"
  );

  const categories = {};

  expenses.forEach(item => {
    categories[item.category] =
      (categories[item.category] || 0) + item.amount;
  });

  const labels = Object.keys(categories);
  const values = Object.values(categories);

  const ctx = document
    .getElementById("expenseChart")
    .getContext("2d");

  if (expenseChart) {
    expenseChart.destroy();
  }

  expenseChart = new Chart(ctx, {
    type: "doughnut",

    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: [
          "#9275ff",
          "#35d39a",
          "#ff7185",
          "#ffbd69",
          "#50b9ed",
          "#e879f9",
          "#a3e635",
          "#94a3b8"
        ],
        borderWidth: 0,
        hoverOffset: 8
      }]
    },

    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "70%",

      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "#c3c7d5",
            padding: 15,
            usePointStyle: true
          }
        }
      }
    }
  });
}

form.addEventListener("submit", addTransaction);

updateDashboard();
updateDashboard();


// ===================================
// MONTHLY BUDGET TRACKER
// ===================================

const budgetInput = document.getElementById("monthly-budget");
const saveBudgetButton = document.getElementById("save-budget");

const budgetTotal = document.getElementById("budget-total");
const budgetSpent = document.getElementById("budget-spent");
const budgetRemaining = document.getElementById("budget-remaining");

const budgetPercentage = document.getElementById("budget-percentage");
const budgetProgressBar = document.getElementById("budget-progress-bar");
const budgetMessage = document.getElementById("budget-message");

let monthlyBudget = 0;

try {
  const savedBudget = Number(
    localStorage.getItem("pennytrack-budget")
  );

  if (
    Number.isFinite(savedBudget) &&
    savedBudget > 0 &&
    savedBudget <= 100000000
  ) {
    monthlyBudget = savedBudget;
  }
} catch (error) {
  console.error("Unable to load budget:", error);
}

budgetInput.value = monthlyBudget || "";

saveBudgetButton.addEventListener("click", () => {
  const value = Number(budgetInput.value);

  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 100000000
  ) {
    alert("Please enter a valid budget amount.");
    return;
  }

  monthlyBudget = Math.round(value * 100) / 100;

  localStorage.setItem(
    "pennytrack-budget",
    String(monthlyBudget)
  );

  updateBudget();
});

function updateBudget() {
  const currentMonth = new Date().toLocaleDateString("en-CA")
    .slice(0, 7);

  const spent = transactions
    .filter(item =>
      item.type === "expense" &&
      item.date.startsWith(currentMonth)
    )
    .reduce((total, item) => total + item.amount, 0);

  const remaining = monthlyBudget - spent;

  const percentage = monthlyBudget > 0
    ? (spent / monthlyBudget) * 100
    : 0;

  budgetTotal.textContent = peso(monthlyBudget);
  budgetSpent.textContent = peso(spent);
  budgetRemaining.textContent = peso(remaining);

  budgetPercentage.textContent =
    `${percentage.toFixed(1)}%`;

  budgetProgressBar.style.width =
    `${Math.min(percentage, 100)}%`;

  if (monthlyBudget === 0) {
    budgetMessage.textContent =
      "Set your budget to start tracking!";

    budgetProgressBar.style.background = "#969bad";
  } else if (percentage >= 100) {
    budgetMessage.textContent =
      "Warning! You've exceeded your monthly budget.";

    budgetProgressBar.style.background = "#ff7185";
  } else if (percentage >= 80) {
    budgetMessage.textContent =
      "Careful! You're getting close to your budget limit.";

    budgetProgressBar.style.background = "#ffbd69";
  } else {
    budgetMessage.textContent =
      "Great job! You're staying within your budget.";

    budgetProgressBar.style.background = "#35d39a";
  }
}

// Update budget whenever dashboard transactions change.

const originalUpdateDashboard = updateDashboard;

updateDashboard = function () {
  originalUpdateDashboard();
  updateBudget();
};

updateBudget();

// SEARCH AND FILTER EVENTS

document
  .getElementById("search-transactions")
  .addEventListener("input", renderTransactions);

document
  .getElementById("filter-transactions")
  .addEventListener("change", renderTransactions);

// EDIT TRANSACTION

function editTransaction(id) {
  const item = transactions.find(
    transaction => transaction.id === id
  );

  if (!item) return;

  const description = prompt(
    "Edit description:",
    item.description
  );

  if (description === null) return;

  const amount = prompt(
    "Edit amount:",
    item.amount
  );

  if (amount === null) return;

  const category = prompt(
    "Edit category:",
    item.category
  );

  if (category === null) return;

  const type = prompt(
    "Enter income or expense:",
    item.type
  );

  if (type === null) return;

  const date = prompt(
    "Edit date (YYYY-MM-DD):",
    item.date
  );

  if (date === null) return;

  const cleanDescription = description.trim();
  const cleanAmount = Number(amount);
  const cleanType = type.trim().toLowerCase();
  const cleanCategory = category.trim();

  if (
    !cleanDescription ||
    !Number.isFinite(cleanAmount) ||
    cleanAmount <= 0 ||
    cleanAmount > 100000000 ||
    !["income", "expense"].includes(cleanType) ||
    !cleanCategory ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(date + "T00:00:00"))
  ) {
    alert("Invalid transaction details. Please try again.");
    return;
  }

  item.description = cleanDescription;
  item.amount = Math.round(cleanAmount * 100) / 100;
  item.category = cleanCategory;
  item.type = cleanType;
  item.date = date;

  saveTransactions();
  updateDashboard();

  alert("Transaction updated successfully!");
}
