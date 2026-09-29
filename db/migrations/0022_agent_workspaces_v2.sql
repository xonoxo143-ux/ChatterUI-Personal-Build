CREATE TABLE `workspace_characters` (
	`workspace_id` text NOT NULL,
	`character_id` integer NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	PRIMARY KEY(`workspace_id`, `character_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace_chats` (
	`chat_id` integer PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspace_chats_workspace_idx` ON `workspace_chats` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspace_permissions` (
	`workspace_id` text NOT NULL,
	`capability` text NOT NULL,
	`decision` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `capability`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace_runtimes` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`backend` text DEFAULT 'embedded-proot' NOT NULL,
	`distro_id` text DEFAULT 'debian' NOT NULL,
	`runtime_version` text DEFAULT '1' NOT NULL,
	`rootfs_version` text DEFAULT '' NOT NULL,
	`state` text DEFAULT 'not_installed' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`installed_at` integer,
	`last_used_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`access_profile` text DEFAULT 'full_access' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workspaces_updated_idx` ON `workspaces` (`updated_at`);