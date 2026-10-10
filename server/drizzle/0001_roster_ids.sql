ALTER TABLE "roster" DROP CONSTRAINT "roster_pkey";--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "reporting_senior_roster_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "reviewing_officer_roster_id" uuid;--> statement-breakpoint
ALTER TABLE "roster" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_reporting_senior_roster_id_roster_id_fk" FOREIGN KEY ("reporting_senior_roster_id") REFERENCES "public"."roster"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_reviewing_officer_roster_id_roster_id_fk" FOREIGN KEY ("reviewing_officer_roster_id") REFERENCES "public"."roster"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster" ADD CONSTRAINT "roster_email_unique" UNIQUE("email");