ALTER TABLE `users` ADD `bitget_futures_live_api_key` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `bitget_futures_live_api_secret` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `bitget_futures_live_passphrase` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `bitget_futures_execution_mode` text DEFAULT 'DEMO' NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `bitget_futures_live_max_leverage` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `crypto_auto_orders` ADD `execution_mode` text DEFAULT 'DEMO' NOT NULL;
