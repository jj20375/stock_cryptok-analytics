ALTER TABLE `paper_trades` ADD `mode` text DEFAULT 'PAPER' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `trading_mode` text DEFAULT 'PAPER' NOT NULL;