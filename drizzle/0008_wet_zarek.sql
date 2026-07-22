CREATE TABLE `backtest_trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`backtest_id` integer NOT NULL,
	`side` text NOT NULL,
	`entry_time` integer NOT NULL,
	`exit_time` integer,
	`entry_price` real NOT NULL,
	`exit_price` real,
	`quantity` real NOT NULL,
	`fee` real DEFAULT 0 NOT NULL,
	`pnl` real,
	`pnl_pct` real,
	`holding_bars` integer,
	`entry_reason` text,
	`exit_reason` text,
	FOREIGN KEY (`backtest_id`) REFERENCES `backtests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_bt_trades` ON `backtest_trades` (`backtest_id`);--> statement-breakpoint
CREATE TABLE `backtests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`strategy_id` text NOT NULL,
	`symbol` text NOT NULL,
	`market` text NOT NULL,
	`interval` text NOT NULL,
	`start_time` integer NOT NULL,
	`end_time` integer NOT NULL,
	`params_json` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`progress_cursor` integer,
	`result_json` text,
	`equity_curve_json` text,
	`error` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `kline_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`market` text NOT NULL,
	`interval` text NOT NULL,
	`open_time` integer NOT NULL,
	`open` real NOT NULL,
	`high` real NOT NULL,
	`low` real NOT NULL,
	`close` real NOT NULL,
	`volume` real NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_kline_unique` ON `kline_cache` (`symbol`,`interval`,`open_time`);--> statement-breakpoint
ALTER TABLE `users` ADD `alpaca_api_key` text;--> statement-breakpoint
ALTER TABLE `users` ADD `alpaca_api_secret` text;