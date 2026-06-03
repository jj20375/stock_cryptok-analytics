CREATE TABLE `paper_trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`status` text NOT NULL,
	`entry_price` text NOT NULL,
	`amount` text NOT NULL,
	`exit_price` text,
	`pnl` text,
	`reason` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
