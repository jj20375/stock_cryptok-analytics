CREATE TABLE `user_portfolio` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`symbol` text NOT NULL,
	`name` text,
	`market` text NOT NULL,
	`avg_price` text,
	`shares` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
