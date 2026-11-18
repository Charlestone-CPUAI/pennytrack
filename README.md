
# PennyTrack 💰

A modern, responsive personal expense tracker
built with HTML, CSS, and JavaScript.

## Features

- Dashboard with balance, income, and expenses
- Add income and expense transactions
- Categorize transactions
- Delete transactions
- Expense breakdown using Chart.js
- Secure email/password sign-in with Supabase Auth
- Cloud sync for transactions, budgets, and categories
- Local cache for a smoother experience
- Responsive desktop and mobile design
- Philippine Peso (PHP) currency

## Technologies

- HTML5
- CSS3
- JavaScript
- Chart.js
- Supabase Auth and Postgres

## How to Run

1. Download or clone this repository.
2. Open the project folder.
3. In your Supabase dashboard, open **SQL Editor**, create a query, and run the complete contents of [database.sql](database.sql). This creates the app tables and Row Level Security policies required by the browser client.
4. In **Authentication → URL Configuration**, set the Site URL and add the URL where you host PennyTrack as an allowed Redirect URL. For local development, use the address from your static server (for example `http://localhost:8000`).
5. Serve the folder through a static web server, then open its local URL. For example, if Python is installed: `python -m http.server 8000`.

The configured client key is a Supabase publishable key. Never add a service-role key to this repository or browser code.

## Developer

Created as a personal portfolio project.

## License

MIT
