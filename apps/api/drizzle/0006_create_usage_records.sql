CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_message_id" uuid NOT NULL,
	"model_price_id" uuid NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"credits" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_user_message_id_user_messages_id_fk" FOREIGN KEY ("user_message_id") REFERENCES "public"."user_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_model_price_id_model_prices_id_fk" FOREIGN KEY ("model_price_id") REFERENCES "public"."model_prices"("id") ON DELETE no action ON UPDATE no action;