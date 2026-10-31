CREATE TABLE `audio_generation` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`provider_job_id` text,
	`model` text NOT NULL,
	`model_name` text NOT NULL,
	`prompt` text NOT NULL,
	`variant` text,
	`voice_id` text,
	`voice_type` text,
	`voice_name` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`result_url` text,
	`error` text,
	`params` text,
	`credits_cost` real,
	`duration_seconds` real,
	`voice_gender` text,
	`voice_age` text,
	`voice_thumbnail_url` text,
	`voice_waveform_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	CONSTRAINT `fk_audio_generation_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `audio_generation_user_created_idx` ON `audio_generation` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `audio_generation_provider_job_idx` ON `audio_generation` (`provider_job_id`);--> statement-breakpoint
CREATE INDEX `audio_generation_status_idx` ON `audio_generation` (`status`);