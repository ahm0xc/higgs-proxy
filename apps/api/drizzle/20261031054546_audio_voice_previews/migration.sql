CREATE TABLE IF NOT EXISTS `audio_voice_preview` (
	`id` text PRIMARY KEY,
	`voice_id` text NOT NULL,
	`voice_type` text NOT NULL,
	`voice_name` text NOT NULL,
	`model` text NOT NULL,
	`sentence` text NOT NULL,
	`provider_job_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`result_url` text,
	`error` text,
	`gender` text,
	`age` text,
	`thumbnail_url` text,
	`source_url` text,
	`waveform_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `image_generation` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`provider_job_id` text,
	`model` text NOT NULL,
	`model_name` text NOT NULL,
	`prompt` text NOT NULL,
	`aspect_ratio` text DEFAULT '1:1' NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`resolution` text,
	`quality` text,
	`seed` integer,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`result_url` text,
	`thumbnail_url` text,
	`error` text,
	`params` text,
	`credits_cost` integer,
	`is_favorite` integer DEFAULT false NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	CONSTRAINT `fk_image_generation_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `image_generation_input` (
	`id` text PRIMARY KEY,
	`generation_id` text NOT NULL,
	`role` text DEFAULT 'reference' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`upload_id` text,
	`url` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_image_generation_input_generation_id_image_generation_id_fk` FOREIGN KEY (`generation_id`) REFERENCES `image_generation`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `audio_voice_preview_voice_idx` ON `audio_voice_preview` (`voice_id`,`voice_type`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audio_voice_preview_status_idx` ON `audio_voice_preview` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `image_generation_user_created_idx` ON `image_generation` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `image_generation_provider_job_idx` ON `image_generation` (`provider_job_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `image_generation_status_idx` ON `image_generation` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `image_generation_input_generation_idx` ON `image_generation_input` (`generation_id`);
