PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_portfolio` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`symbol` text NOT NULL,
	`name` text,
	`market` text NOT NULL,
	`avg_price` text,
	`shares` text,
	`fees` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_user_portfolio`("id", "user_id", "symbol", "name", "market", "avg_price", "shares", "fees", "created_at") SELECT "id", "user_id", "symbol", "name", "market", "avg_price", "shares", "fees", "created_at" FROM `user_portfolio`;--> statement-breakpoint
DROP TABLE `user_portfolio`;--> statement-breakpoint
ALTER TABLE `__new_user_portfolio` RENAME TO `user_portfolio`;--> statement-breakpoint
PRAGMA foreign_keys=ON;