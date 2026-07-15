ALTER TABLE `users` ADD `capital_base_usdt` text DEFAULT '1000' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `max_risk_per_trade_pct` text DEFAULT '0.5' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `max_daily_loss_pct` text DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `max_position_size_pct` text DEFAULT '10' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `risk_stop_loss_pct` text DEFAULT '5' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `max_open_positions` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `max_trades_per_day` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `crypto_crash_guard_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `live_trading_enabled` integer DEFAULT false NOT NULL;