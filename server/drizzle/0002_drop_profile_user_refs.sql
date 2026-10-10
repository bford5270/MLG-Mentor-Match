ALTER TABLE "profiles" DROP CONSTRAINT "profiles_reporting_senior_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_reviewing_officer_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "reporting_senior_user_id";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "reviewing_officer_user_id";