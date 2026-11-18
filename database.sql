-- PennyTrack database schema (PostgreSQL 15+ / Supabase-compatible)
-- Store currency amounts as NUMERIC, never floating-point values.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE app_users (
  id UUID PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (char_length(trim(display_name)) BETWEEN 1 AND 100),
  currency_code CHAR(3) NOT NULL DEFAULT 'PHP' CHECK (currency_code ~ '^[A-Z]{3}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The browser client stores the complete UI state in one user-owned row. This
-- keeps the current offline-friendly application model while making Supabase
-- the source of truth for signed-in users.
CREATE TABLE app_state (
  user_id UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  transactions JSONB NOT NULL DEFAULT '[]'::jsonb,
  monthly_budget NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (monthly_budget >= 0 AND monthly_budget <= 100000000),
  custom_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  category_budgets JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name),
  UNIQUE (id, user_id)
);

CREATE TABLE monthly_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  period_month DATE NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0 AND amount <= 100000000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_month),
  UNIQUE (id, user_id)
);

CREATE TABLE recurring_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  description TEXT NOT NULL CHECK (char_length(trim(description)) BETWEEN 1 AND 60),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0 AND amount <= 100000000),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('income', 'expense')),
  category_id UUID NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
  starts_on DATE NOT NULL,
  next_run_on DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (category_id, user_id) REFERENCES categories(id, user_id)
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  description TEXT NOT NULL CHECK (char_length(trim(description)) BETWEEN 1 AND 60),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0 AND amount <= 100000000),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('income', 'expense')),
  category_id UUID NOT NULL,
  occurred_on DATE NOT NULL,
  recurring_schedule_id UUID REFERENCES recurring_schedules(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (category_id, user_id) REFERENCES categories(id, user_id)
);

CREATE TABLE category_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  category_id UUID NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0 AND amount <= 100000000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (budget_id, category_id),
  FOREIGN KEY (budget_id, user_id) REFERENCES monthly_budgets(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (category_id, user_id) REFERENCES categories(id, user_id)
);

-- Optional audit/recovery record for imported local backups.
CREATE TABLE data_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  payload JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX transactions_user_date_idx ON transactions (user_id, occurred_on DESC);
CREATE INDEX transactions_user_type_date_idx ON transactions (user_id, transaction_type, occurred_on DESC);
CREATE INDEX recurring_schedules_due_idx ON recurring_schedules (next_run_on) WHERE is_active;
CREATE INDEX data_backups_user_imported_idx ON data_backups (user_id, imported_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER app_users_set_updated_at BEFORE UPDATE ON app_users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER monthly_budgets_set_updated_at BEFORE UPDATE ON monthly_budgets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER recurring_schedules_set_updated_at BEFORE UPDATE ON recurring_schedules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER transactions_set_updated_at BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER category_budgets_set_updated_at BEFORE UPDATE ON category_budgets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER app_state_set_updated_at BEFORE UPDATE ON app_state FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every new user receives the categories currently offered in the UI.
CREATE OR REPLACE FUNCTION seed_default_categories()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO categories (user_id, name)
  SELECT NEW.id, category_name
  FROM unnest(ARRAY['Salary', 'Food', 'Transportation', 'Shopping', 'Bills', 'Entertainment', 'Education', 'Other']) AS category_name;
  RETURN NEW;
END;
$$;

CREATE TRIGGER app_users_seed_default_categories
AFTER INSERT ON app_users
FOR EACH ROW EXECUTE FUNCTION seed_default_categories();

-- Browser access is restricted to the signed-in owner of each record.
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_backups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage their own profile" ON app_users FOR ALL TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "users manage their own app state" ON app_state FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users manage their own categories" ON categories FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users manage their own budgets" ON monthly_budgets FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users manage their own schedules" ON recurring_schedules FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users manage their own transactions" ON transactions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users manage their own category budgets" ON category_budgets FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users manage their own backups" ON data_backups FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

COMMIT;
