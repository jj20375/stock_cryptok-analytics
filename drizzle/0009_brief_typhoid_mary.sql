ALTER TABLE `paper_trades` ADD `market` text DEFAULT 'CRYPTO' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `bitget_api_key` text;--> statement-breakpoint
ALTER TABLE `users` ADD `bitget_api_secret` text;--> statement-breakpoint
ALTER TABLE `users` ADD `bitget_passphrase` text;--> statement-breakpoint
ALTER TABLE `users` ADD `preferred_exchange` text DEFAULT 'BINANCE' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `stock_auto_trading_enabled` integer DEFAULT false NOT NULL;