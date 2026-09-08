CREATE TABLE `wave_lease` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wave_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`message` text NOT NULL,
	`created_at` integer NOT NULL,
	`sent_at` integer
);
--> statement-breakpoint
CREATE TABLE `wave_radar` (
	`symbol` text PRIMARY KEY NOT NULL,
	`snapshot_json` text NOT NULL,
	`checked_at` integer NOT NULL
);
