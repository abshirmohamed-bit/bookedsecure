export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_actions: {
        Row: {
          action_kind: string
          activation_id: string | null
          attempt_count: number
          blocked_reason: string | null
          business_id: string
          campaign_id: string | null
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          failure_reason: string | null
          id: string
          idempotency_key: string
          lead_id: string | null
          max_attempts: number
          mode: string
          plan_snapshot: Json | null
          result_kind: string | null
          result_ref: string | null
          rollback_actor: string | null
          rollback_reason: string | null
          rolled_back_at: string | null
          scheduled_for: string | null
          sequence_id: string
          status: string
          template_id: string | null
          updated_at: string
        }
        Insert: {
          action_kind: string
          activation_id?: string | null
          attempt_count?: number
          blocked_reason?: string | null
          business_id: string
          campaign_id?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          lead_id?: string | null
          max_attempts?: number
          mode?: string
          plan_snapshot?: Json | null
          result_kind?: string | null
          result_ref?: string | null
          rollback_actor?: string | null
          rollback_reason?: string | null
          rolled_back_at?: string | null
          scheduled_for?: string | null
          sequence_id: string
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          action_kind?: string
          activation_id?: string | null
          attempt_count?: number
          blocked_reason?: string | null
          business_id?: string
          campaign_id?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          lead_id?: string | null
          max_attempts?: number
          mode?: string
          plan_snapshot?: Json | null
          result_kind?: string | null
          result_ref?: string | null
          rollback_actor?: string | null
          rollback_reason?: string | null
          rolled_back_at?: string | null
          scheduled_for?: string | null
          sequence_id?: string
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_actions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_actions_campaign_fk"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "sequence_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_actions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_inbox_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_actions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_outputs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          business_id: string
          created_at: string
          extracted_fields: Json | null
          id: string
          lead_id: string
          missing_fields: Json | null
          needs_human_review: boolean
          readiness: string | null
          suggested_reply: string | null
          summary: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          business_id: string
          created_at?: string
          extracted_fields?: Json | null
          id?: string
          lead_id: string
          missing_fields?: Json | null
          needs_human_review?: boolean
          readiness?: string | null
          suggested_reply?: string | null
          summary?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          business_id?: string
          created_at?: string
          extracted_fields?: Json | null
          id?: string
          lead_id?: string
          missing_fields?: Json | null
          needs_human_review?: boolean
          readiness?: string | null
          suggested_reply?: string | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_outputs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_outputs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_inbox_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_outputs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_events: {
        Row: {
          business_id: string
          created_at: string
          error_detail: string | null
          estimated_cost: number
          id: string
          input_tokens: number
          lead_id: string | null
          model: string
          output_tokens: number
          purpose: string
          status: string
        }
        Insert: {
          business_id: string
          created_at?: string
          error_detail?: string | null
          estimated_cost?: number
          id?: string
          input_tokens?: number
          lead_id?: string | null
          model: string
          output_tokens?: number
          purpose: string
          status?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          error_detail?: string | null
          estimated_cost?: number
          id?: string
          input_tokens?: number
          lead_id?: string | null
          model?: string
          output_tokens?: number
          purpose?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_inbox_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_messages: {
        Row: {
          business_id: string
          created_at: string
          done: string | null
          id: string
          parts: Json
          proposals: Json
          role: string
          thread_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          done?: string | null
          id?: string
          parts?: Json
          proposals?: Json
          role: string
          thread_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          done?: string | null
          id?: string
          parts?: Json
          proposals?: Json
          role?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "assistant_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_threads: {
        Row: {
          archived_at: string | null
          business_id: string
          created_at: string
          created_by: string
          id: string
          is_default: boolean
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          business_id: string
          created_at?: string
          created_by: string
          id?: string
          is_default?: boolean
          title?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          business_id?: string
          created_at?: string
          created_by?: string
          id?: string
          is_default?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_threads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          business_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          business_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_jobs: {
        Row: {
          agent_action_id: string | null
          attempt_count: number
          business_id: string
          created_at: string
          failure_reason: string | null
          id: string
          idempotency_key: string
          job_type: string
          last_attempt_at: string | null
          lead_id: string | null
          max_attempts: number
          next_attempt_at: string | null
          payload: Json | null
          run_at: string
          sequence_id: string | null
          sequence_step_template_id: string | null
          status: string
          step: number
          updated_at: string
        }
        Insert: {
          agent_action_id?: string | null
          attempt_count?: number
          business_id: string
          created_at?: string
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          job_type: string
          last_attempt_at?: string | null
          lead_id?: string | null
          max_attempts?: number
          next_attempt_at?: string | null
          payload?: Json | null
          run_at?: string
          sequence_id?: string | null
          sequence_step_template_id?: string | null
          status?: string
          step?: number
          updated_at?: string
        }
        Update: {
          agent_action_id?: string | null
          attempt_count?: number
          business_id?: string
          created_at?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          job_type?: string
          last_attempt_at?: string | null
          lead_id?: string | null
          max_attempts?: number
          next_attempt_at?: string | null
          payload?: Json | null
          run_at?: string
          sequence_id?: string | null
          sequence_step_template_id?: string | null
          status?: string
          step?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_jobs_agent_action_id_fkey"
            columns: ["agent_action_id"]
            isOneToOne: false
            referencedRelation: "agent_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_jobs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_jobs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_inbox_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_jobs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          active: boolean
          business_id: string
          created_at: string
          delay_minutes: number
          id: string
          message_template: string
          rule_type: string
          step: number
        }
        Insert: {
          active?: boolean
          business_id: string
          created_at?: string
          delay_minutes?: number
          id?: string
          message_template: string
          rule_type: string
          step?: number
        }
        Update: {
          active?: boolean
          business_id?: string
          created_at?: string
          delay_minutes?: number
          id?: string
          message_template?: string
          rule_type?: string
          step?: number
        }
        Relationships: [
          {
            foreignKeyName: "automation_rules_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_availability: {
        Row: {
          active: boolean
          business_id: string
          created_at: string
          horizon_days: number
          lead_time_minutes: number
          offer_ttl_minutes: number
          updated_at: string
          weekly_windows: Json
        }
        Insert: {
          active?: boolean
          business_id: string
          created_at?: string
          horizon_days?: number
          lead_time_minutes?: number
          offer_ttl_minutes?: number
          updated_at?: string
          weekly_windows?: Json
        }
        Update: {
          active?: boolean
          business_id?: string
          created_at?: string
          horizon_days?: number
          lead_time_minutes?: number
          offer_ttl_minutes?: number
          updated_at?: string
          weekly_windows?: Json
        }
        Relationships: [
          {
            foreignKeyName: "booking_availability_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_offers: {
        Row: {
          accepted_at: string | null
          accepted_message_id: string | null
          business_id: string
          confirmation_message_id: string | null
          confirmation_sms_sent_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          expires_at: string
          id: string
          job_id: string | null
          lead_id: string
          service_id: string | null
          service_name_snapshot: string | null
          slot_end: string
          slot_start: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_message_id?: string | null
          business_id: string
          confirmation_message_id?: string | null
          confirmation_sms_sent_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          expires_at: string
          id?: string
          job_id?: string | null
          lead_id: string
          service_id?: string | null
          service_name_snapshot?: string | null
          slot_end: string
          slot_start: string
          status?: string
          timezone: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_message_id?: string | null
          business_id?: string
          confirmation_message_id?: string | null
          confirmation_sms_sent_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          job_id?: string | null
          lead_id?: string
          service_id?: string | null
          service_name_snapshot?: string | null
          slot_end?: string
          slot_start?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_offers_accepted_message_id_fkey"
            columns: ["accepted_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_offers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_offers_confirmation_message_id_fkey"
            columns: ["confirmation_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_offers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_offers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "lead_inbox_rows"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "booking_offers_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_inbox_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_offers_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_offers_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          agent_daily_send_cap: number
          agent_enabled: boolean
          agent_execution_opted_in_at: string | null
          agent_execution_opted_in_by: string | null
          agent_hourly_send_cap: number
          agent_kill_switch_at: string | null
          agent_kill_switch_by: string | null
          agent_kill_switch_reason: string | null
          agent_max_leads_per_activation: number
          automation_enabled: boolean
          created_at: string
          default_sms_provider: string
          flexible_requests_enabled: boolean
          id: string
          logo_storage_path: string | null
          logo_url: string | null
          name: string
          opening_hours: string | null
          owner_notification_name: string | null
          owner_notification_number: string | null
          phone_number: string | null
          plan_id: string
          privacy_policy_url: string | null
          quiet_hours_end: number
          quiet_hours_start: number
          quote_form_active: boolean
          quote_mode: string
          service_area: string | null
          slug: string | null
          sms_credential_mode: string
          sms_signature: string | null
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          agent_daily_send_cap?: number
          agent_enabled?: boolean
          agent_execution_opted_in_at?: string | null
          agent_execution_opted_in_by?: string | null
          agent_hourly_send_cap?: number
          agent_kill_switch_at?: string | null
          agent_kill_switch_by?: string | null
          agent_kill_switch_reason?: string | null
          agent_max_leads_per_activation?: number
          automation_enabled?: boolean
          created_at?: string
          default_sms_provider?: string
          flexible_requests_enabled?: boolean
          id?: string
          logo_storage_path?: string | null
          logo_url?: string | null
          name: string
          opening_hours?: string | null
          owner_notification_name?: string | null
          owner_notification_number?: string | null
          phone_number?: string | null
          plan_id?: string
          privacy_policy_url?: string | null
          quiet_hours_end?: number
          quiet_hours_start?: number
          quote_form_active?: boolean
          quote_mode?: string
          service_area?: string | null
          slug?: string | null
          sms_credential_mode?: string
          sms_signature?: string | null
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          agent_daily_send_cap?: number
          agent_enabled?: boolean
          agent_execution_opted_in_at?: string | null
          agent_execution_opted_in_by?: string | null
          agent_hourly_send_cap?: number
          agent_kill_switch_at?: string | null
          agent_kill_switch_by?: string | null
          agent_kill_switch_reason?: string | null
          agent_max_leads_per_activation?: number
          automation_enabled?: boolean
          created_at?: string
          default_sms_provider?: string
          flexible_requests_enabled?: boolean
          id?: string
          logo_storage_path?: string | null
          logo_url?: string | null
          name?: string
          opening_hours?: string | null
          owner_notification_name?: string | null
          owner_notification_number?: string | null
          phone_number?: string | null
          plan_id?: string
          privacy_policy_url?: string | null
          quiet_hours_end?: number
          quiet_hours_start?: number
          quote_form_active?: boolean
          quote_mode?: string
          service_area?: string | null
          slug?: string | null
          sms_credential_mode?: string
          sms_signature?: string | null
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "businesses_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_config: {
        Row: {
          agent_global_kill_switch_at: string | null
          agent_global_kill_switch_reason: string | null
          billing_interval: string
          cancellation_terms: string
          configuration_version: number
          created_at: string
          currency: string
          id: string
          included_sms_segments: number
          overage_mode: string
          pilot_duration_days: number
          pilot_end_action: string
          pilot_price_minor_units: number
          singleton: boolean
          stripe_product_id: string | null
          stripe_recurring_price_id: string | null
          support_address: string
          support_channel: string
          support_target_business_days: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          agent_global_kill_switch_at?: string | null
          agent_global_kill_switch_reason?: string | null
          billing_interval?: string
          cancellation_terms?: string
          configuration_version?: number
          created_at?: string
          currency?: string
          id?: string
          included_sms_segments?: number
          overage_mode?: string
          pilot_duration_days?: number
          pilot_end_action?: string
          pilot_price_minor_units?: number
          singleton?: boolean
          stripe_product_id?: string | null
          stripe_recurring_price_id?: string | null
          support_address?: string
          support_channel?: string
          support_target_business_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          agent_global_kill_switch_at?: string | null
          agent_global_kill_switch_reason?: string | null
          billing_interval?: string
          cancellation_terms?: string
          configuration_version?: number
          created_at?: string
          currency?: string
          id?: string
          included_sms_segments?: number
          overage_mode?: string
          pilot_duration_days?: number
          pilot_end_action?: string
          pilot_price_minor_units?: number
          singleton?: boolean
          stripe_product_id?: string | null
          stripe_recurring_price_id?: string | null
          support_address?: string
          support_channel?: string
          support_target_business_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      consent_events: {
        Row: {
          business_id: string
          channel: string
          consent_text: string | null
          created_at: string
          event_type: string
          id: string
          lead_id: string
          message_id: string | null
          mobile_number: string | null
          occurred_at: string
          source: string | null
        }
        Insert: {
          business_id: string
          channel?: string
          consent_text?: string | null
          created_at?: string
          event_type: string
          id?: string
          lead_id: string
          message_id?: string | null
          mobile_number?: string | null
          occurred_at?: string
          source?: string | null
        }
        Update: {
          business_id?: string
          channel?: string
          consent_text?: string | null
          created_at?: string
          event_type?: string
          id?: string
          lead_id?: string
          message_id?: string | null
          mobile_number?: string | null
          occurred_at?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consent_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_inbox_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_events_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          automation_paused: boolean
          business_id: string
          created_at: string
          follow_up_overrides: Json
          follow_up_step: number
          id: string
          last_message_at: string | null
          lead_id: string
          next_follow_up_at: string | null
          status: string
        }
        Insert: {
          automation_paused?: boolean
          business_id: string
          created_at?: string
          follow_up_overrides?: Json
          follow_up_step?: number
          id?: string
          last_message_at?: string | null
          lead_id: string
          next_follow_up_at?: string | null
          status?: string
        }
        Update: {
          automation_paused?: boolean
          business_id?: string
          created_at?: string
          follow_up_overrides?: Json
          follow_up_step?: number
          id?: string
          last_message_at?: string | null
          lead_id?: string
          next_follow_up_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_inbox_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_topups: {
        Row: {
          amount_cents: number
          business_id: string
          created_at: string
          credited_at: string | null
          credits: number
          currency: string
          failure_reason: string | null
          id: string
          pack_id: string
          requested_by: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          business_id: string
          created_at?: string
          credited_at?: string | null
          credits: number
          currency?: string
          failure_reason?: string | null
          id?: string
          pack_id: string
          requested_by?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          business_id?: string
          created_at?: string
          credited_at?: string | null
          credits?: number
          currency?: string
          failure_reason?: string | null
          id?: string
          pack_id?: string
          requested_by?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_topups_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      import_automation_state: {
        Row: {
          bounded_batch_batch_id: string | null
          bounded_batch_imported: number
          bounded_batch_passed_at: string | null
          business_id: string
          canary_batch_id: string | null
          canary_lead_id: string | null
          canary_passed_at: string | null
          canary_row_number: number | null
          created_at: string
          exception_only_enabled_at: string | null
          idempotency_verified_at: string | null
          last_run_at: string | null
          last_summary: Json | null
          mode: string
          mode_reason: string | null
          paused: boolean
          updated_at: string
        }
        Insert: {
          bounded_batch_batch_id?: string | null
          bounded_batch_imported?: number
          bounded_batch_passed_at?: string | null
          business_id: string
          canary_batch_id?: string | null
          canary_lead_id?: string | null
          canary_passed_at?: string | null
          canary_row_number?: number | null
          created_at?: string
          exception_only_enabled_at?: string | null
          idempotency_verified_at?: string | null
          last_run_at?: string | null
          last_summary?: Json | null
          mode?: string
          mode_reason?: string | null
          paused?: boolean
          updated_at?: string
        }
        Update: {
          bounded_batch_batch_id?: string | null
          bounded_batch_imported?: number
          bounded_batch_passed_at?: string | null
          business_id?: string
          canary_batch_id?: string | null
          canary_lead_id?: string | null
          canary_passed_at?: string | null
          canary_row_number?: number | null
          created_at?: string
          exception_only_enabled_at?: string | null
          idempotency_verified_at?: string | null
          last_run_at?: string | null
          last_summary?: Json | null
          mode?: string
          mode_reason?: string | null
          paused?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_automation_state_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          business_id: string
          created_at: string
          created_rows: number
          duplicate_rows: number
          filename: string | null
          format: string
          id: string
          invalid_rows: number
          skipped_rows: number
          status: string
          total_rows: number
          updated_at: string
          uploaded_by: string | null
          valid_rows: number
        }
        Insert: {
          business_id: string
          created_at?: string
          created_rows?: number
          duplicate_rows?: number
          filename?: string | null
          format: string
          id?: string
          invalid_rows?: number
          skipped_rows?: number
          status?: string
          total_rows?: number
          updated_at?: string
          uploaded_by?: string | null
          valid_rows?: number
        }
        Update: {
          business_id?: string
          created_at?: string
          created_rows?: number
          duplicate_rows?: number
          filename?: string | null
          format?: string
          id?: string
          invalid_rows?: number
          skipped_rows?: number
          status?: string
          total_rows?: number
          updated_at?: string
          uploaded_by?: string | null
          valid_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          business_id: string
          completed_at: string | null
          completed_value: number | null
          completion_status: string
          created_at: string
          id: string
          lead_id: string
          notes: string | null
          scheduled_at: string | null
          service_id: string | null
          service_performed: string | null
        }
        Insert: {
          business_id: string
          completed_at?: string | null
          completed_value?: number | null
          completion_status?: string
          created_at?: string
          id?: string
          lead_id: string
          notes?: string | null
          scheduled_at?: string | null
          service_id?: string | null
          service_performed?: string | null
        }
        Update: {
          business_id?: string
          completed_at?: string | null
          completed_value?: number | null
          completion_status?: string
          created_at?: string
          id?: string
          lead_id?: string
          notes?: string | null
          scheduled_at?: string | null
          service_id?: string | null
          service_performed?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_inbox_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_deletion_requests: {
        Row: {
          action: string
          actor_user_id: string | null
          business_id: string
          created_at: string
          deleted_count: number
          failed_count: number
          failures: Json
          id: string
          reason: string | null
          request_id: string
          requested_count: number
          requested_lead_ids: string[]
          status: string
          updated_at: string
        }
        Insert: {
          action?: string
          actor_user_id?: string | null
          business_id: string
          created_at?: string
          deleted_count?: number
          failed_count?: number
          failures?: Json
          id?: string
          reason?: string | null
          request_id: string
          requested_count?: number
          requested_lead_ids?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          business_id?: string
          created_at?: string
          deleted_count?: number
          failed_count?: number
          failures?: Json
          id?: string
          reason?: string | null
          request_id?: string
          requested_count?: number
          requested_lead_ids?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_deletion_requests_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_import_rows: {
        Row: {
          batch_id: string
          business_id: string
          created_at: string
          decision: string
          dedupe_match_lead_id: string | null
          id: string
          normalized_payload: Json | null
          raw_row: Json | null
          resulting_lead_id: string | null
          row_number: number
          updated_at: string
          validation_errors: Json
        }
        Insert: {
          batch_id: string
          business_id: string
          created_at?: string
          decision?: string
          dedupe_match_lead_id?: string | null
          id?: string
          normalized_payload?: Json | null
          raw_row?: Json | null
          resulting_lead_id?: string | null
          row_number: number
          updated_at?: string
          validation_errors?: Json
        }
        Update: {
          batch_id?: string
          business_id?: string
          created_at?: string
          decision?: string
          dedupe_match_lead_id?: string | null
          id?: string
          normalized_payload?: Json | null
          raw_row?: Json | null
          resulting_lead_id?: string | null
          row_number?: number
          updated_at?: string
          validation_errors?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lead_import_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_import_rows_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_import_rows_dedupe_match_lead_id_fkey"
            columns: ["dedupe_match_lead_id"]
            isOneToOne: false
            referencedRelation: "lead_inbox_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_import_rows_dedupe_match_lead_id_fkey"
            columns: ["dedupe_match_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_import_rows_resulting_lead_id_fkey"
            columns: ["resulting_lead_id"]
            isOneToOne: false
            referencedRelation: "lead_inbox_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_import_rows_resulting_lead_id_fkey"
            columns: ["resulting_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          approved_service_id: string | null
          assigned_to: string | null
          booking_status: string
          business_id: string
          consent_record: Json | null
          consent_source: string | null
          consent_status: string
          context_verified_at: string | null
          created_at: string
          current_sequence: string | null
          customer_status: string
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
          deletion_request_id: string | null
          email: string | null
          email_normalised: string | null
          external_id: string | null
          first_contacted_at: string | null
          first_reply_at: string | null
          flexible_request_text: string | null
          id: string
          import_batch_id: string | null
          last_cleaned_at: string | null
          last_delivered_sms_at: string | null
          last_inbound_reply_at: string | null
          last_outbound_sms_at: string | null
          last_outbound_sms_status: string | null
          last_permanent_failure_at: string | null
          last_reply_at: string | null
          last_sms_failure_at: string | null
          last_sms_failure_code: string | null
          last_sms_failure_reason: string | null
          last_successful_delivery_at: string | null
          lead_context: string
          lead_origin: string | null
          main_concerns: string | null
          manual_entry_by: string | null
          mobile_number: string
          name: string
          notes: string | null
          opted_out_at: string | null
          public_token: string
          quote_status: string
          reachability_evidence: string | null
          reachability_evidence_at: string | null
          reachability_state: string
          readiness_classification: string | null
          request_type: string | null
          requires_owner_review: boolean
          service_address: string | null
          service_intent: string | null
          service_name_snapshot: string | null
          sms_suppressed_at: string | null
          sms_suppression_reason: string | null
          source_campaign: string | null
          source_channel: string
          source_form: string | null
          source_metadata: Json | null
          status: string
          suburb: string | null
          updated_at: string
          utm_campaign: string | null
          utm_source: string | null
          vehicle_type: string | null
          verified_concern: string | null
          verified_service_id: string | null
          verified_suburb: string | null
          verified_vehicle: string | null
        }
        Insert: {
          approved_service_id?: string | null
          assigned_to?: string | null
          booking_status?: string
          business_id: string
          consent_record?: Json | null
          consent_source?: string | null
          consent_status?: string
          context_verified_at?: string | null
          created_at?: string
          current_sequence?: string | null
          customer_status?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          deletion_request_id?: string | null
          email?: string | null
          email_normalised?: string | null
          external_id?: string | null
          first_contacted_at?: string | null
          first_reply_at?: string | null
          flexible_request_text?: string | null
          id?: string
          import_batch_id?: string | null
          last_cleaned_at?: string | null
          last_delivered_sms_at?: string | null
          last_inbound_reply_at?: string | null
          last_outbound_sms_at?: string | null
          last_outbound_sms_status?: string | null
          last_permanent_failure_at?: string | null
          last_reply_at?: string | null
          last_sms_failure_at?: string | null
          last_sms_failure_code?: string | null
          last_sms_failure_reason?: string | null
          last_successful_delivery_at?: string | null
          lead_context?: string
          lead_origin?: string | null
          main_concerns?: string | null
          manual_entry_by?: string | null
          mobile_number: string
          name: string
          notes?: string | null
          opted_out_at?: string | null
          public_token?: string
          quote_status?: string
          reachability_evidence?: string | null
          reachability_evidence_at?: string | null
          reachability_state?: string
          readiness_classification?: string | null
          request_type?: string | null
          requires_owner_review?: boolean
          service_address?: string | null
          service_intent?: string | null
          service_name_snapshot?: string | null
          sms_suppressed_at?: string | null
          sms_suppression_reason?: string | null
          source_campaign?: string | null
          source_channel?: string
          source_form?: string | null
          source_metadata?: Json | null
          status?: string
          suburb?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_source?: string | null
          vehicle_type?: string | null
          verified_concern?: string | null
          verified_service_id?: string | null
          verified_suburb?: string | null
          verified_vehicle?: string | null
        }
        Update: {
          approved_service_id?: string | null
          assigned_to?: string | null
          booking_status?: string
          business_id?: string
          consent_record?: Json | null
          consent_source?: string | null
          consent_status?: string
          context_verified_at?: string | null
          created_at?: string
          current_sequence?: string | null
          customer_status?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          deletion_request_id?: string | null
          email?: string | null
          email_normalised?: string | null
          external_id?: string | null
          first_contacted_at?: string | null
          first_reply_at?: string | null
          flexible_request_text?: string | null
          id?: string
          import_batch_id?: string | null
          last_cleaned_at?: string | null
          last_delivered_sms_at?: string | null
          last_inbound_reply_at?: string | null
          last_outbound_sms_at?: string | null
          last_outbound_sms_status?: string | null
          last_permanent_failure_at?: string | null
          last_reply_at?: string | null
          last_sms_failure_at?: string | null
          last_sms_failure_code?: string | null
          last_sms_failure_reason?: string | null
          last_successful_delivery_at?: string | null
          lead_context?: string
          lead_origin?: string | null
          main_concerns?: string | null
          manual_entry_by?: string | null
          mobile_number?: string
          name?: string
          notes?: string | null
          opted_out_at?: string | null
          public_token?: string
          quote_status?: string
          reachability_evidence?: string | null
          reachability_evidence_at?: string | null
          reachability_state?: string
          readiness_classification?: string | null
          request_type?: string | null
          requires_owner_review?: boolean
          service_address?: string | null
          service_intent?: string | null
          service_name_snapshot?: string | null
          sms_suppressed_at?: string | null
          sms_suppression_reason?: string | null
          source_campaign?: string | null
          source_channel?: string
          source_form?: string | null
          source_metadata?: Json | null
          status?: string
          suburb?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_source?: string | null
          vehicle_type?: string | null
          verified_concern?: string | null
          verified_service_id?: string | null
          verified_suburb?: string | null
          verified_vehicle?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_approved_service_id_fkey"
            columns: ["approved_service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_verified_service_id_fkey"
            columns: ["verified_service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          agent_action_id: string | null
          attempt_count: number
          automation_stopped: boolean
          body: string
          business_id: string
          conversation_id: string | null
          created_at: string
          delivered_at: string | null
          delivery_event_count: number
          delivery_status: string
          direction: string
          error_code: string | null
          failed_at: string | null
          failure_class: string | null
          failure_code: string | null
          failure_reason: string | null
          from_number: string | null
          id: string
          idempotency_key: string | null
          last_provider_event_at: string | null
          last_provider_event_id: string | null
          lead_id: string
          message_kind: string
          message_source: string | null
          next_retry_at: string | null
          provider: string | null
          provider_accepted_at: string | null
          provider_cost: number | null
          provider_message_id: string | null
          provider_raw_status: string | null
          received_at: string | null
          recipient_role: string
          reconciled_at: string | null
          segments: number
          sender_id: string | null
          sent_at: string | null
          sequence_id: string | null
          template_id: string | null
          to_number: string | null
        }
        Insert: {
          agent_action_id?: string | null
          attempt_count?: number
          automation_stopped?: boolean
          body: string
          business_id: string
          conversation_id?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_event_count?: number
          delivery_status?: string
          direction: string
          error_code?: string | null
          failed_at?: string | null
          failure_class?: string | null
          failure_code?: string | null
          failure_reason?: string | null
          from_number?: string | null
          id?: string
          idempotency_key?: string | null
          last_provider_event_at?: string | null
          last_provider_event_id?: string | null
          lead_id: string
          message_kind?: string
          message_source?: string | null
          next_retry_at?: string | null
          provider?: string | null
          provider_accepted_at?: string | null
          provider_cost?: number | null
          provider_message_id?: string | null
          provider_raw_status?: string | null
          received_at?: string | null
          recipient_role?: string
          reconciled_at?: string | null
          segments?: number
          sender_id?: string | null
          sent_at?: string | null
          sequence_id?: string | null
          template_id?: string | null
          to_number?: string | null
        }
        Update: {
          agent_action_id?: string | null
          attempt_count?: number
          automation_stopped?: boolean
          body?: string
          business_id?: string
          conversation_id?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_event_count?: number
          delivery_status?: string
          direction?: string
          error_code?: string | null
          failed_at?: string | null
          failure_class?: string | null
          failure_code?: string | null
          failure_reason?: string | null
          from_number?: string | null
          id?: string
          idempotency_key?: string | null
          last_provider_event_at?: string | null
          last_provider_event_id?: string | null
          lead_id?: string
          message_kind?: string
          message_source?: string | null
          next_retry_at?: string | null
          provider?: string | null
          provider_accepted_at?: string | null
          provider_cost?: number | null
          provider_message_id?: string | null
          provider_raw_status?: string | null
          received_at?: string | null
          recipient_role?: string
          reconciled_at?: string | null
          segments?: number
          sender_id?: string | null
          sent_at?: string | null
          sequence_id?: string | null
          template_id?: string | null
          to_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_agent_action_id_fkey"
            columns: ["agent_action_id"]
            isOneToOne: false
            referencedRelation: "agent_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "lead_inbox_rows"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_inbox_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "sms_senders"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          business_id: string
          created_at: string
          id: string
          idempotency_key: string
          kind: string
          lead_id: string | null
          metadata: Json | null
          read_at: string | null
          title: string
          user_id: string | null
        }
        Insert: {
          body: string
          business_id: string
          created_at?: string
          id?: string
          idempotency_key: string
          kind?: string
          lead_id?: string | null
          metadata?: Json | null
          read_at?: string | null
          title: string
          user_id?: string | null
        }
        Update: {
          body?: string
          business_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          kind?: string
          lead_id?: string | null
          metadata?: Json | null
          read_at?: string | null
          title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_inbox_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      pilot_applications: {
        Row: {
          access_state: string
          access_state_reason: string | null
          business_id: string | null
          business_name: string
          cancellation_requested_at: string | null
          challenge: string | null
          commercial_configuration_version: number | null
          commercial_status: string
          commercial_terms_snapshot: Json | null
          contact_name: string
          continuation_approved_at: string | null
          continuation_approved_by: string | null
          continuation_requested_at: string | null
          duplicate_of: string | null
          email: string
          id: string
          internal_notes: string | null
          landing_page: string | null
          last_payment_event_at: string | null
          location: string | null
          payment_completed_at: string | null
          payment_invited_at: string | null
          payment_required: boolean
          phone: string | null
          pilot_ends_at: string | null
          pilot_extension_ends_at: string | null
          pilot_started_at: string | null
          referrer: string | null
          renewal_prevention_attempts: number
          renewal_prevention_confirmed: boolean
          renewal_prevention_last_attempt_at: string | null
          renewal_prevention_last_error: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          services: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          submitted_at: string
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          weekly_enquiry_volume: number | null
        }
        Insert: {
          access_state?: string
          access_state_reason?: string | null
          business_id?: string | null
          business_name: string
          cancellation_requested_at?: string | null
          challenge?: string | null
          commercial_configuration_version?: number | null
          commercial_status?: string
          commercial_terms_snapshot?: Json | null
          contact_name: string
          continuation_approved_at?: string | null
          continuation_approved_by?: string | null
          continuation_requested_at?: string | null
          duplicate_of?: string | null
          email: string
          id?: string
          internal_notes?: string | null
          landing_page?: string | null
          last_payment_event_at?: string | null
          location?: string | null
          payment_completed_at?: string | null
          payment_invited_at?: string | null
          payment_required?: boolean
          phone?: string | null
          pilot_ends_at?: string | null
          pilot_extension_ends_at?: string | null
          pilot_started_at?: string | null
          referrer?: string | null
          renewal_prevention_attempts?: number
          renewal_prevention_confirmed?: boolean
          renewal_prevention_last_attempt_at?: string | null
          renewal_prevention_last_error?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          services?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          submitted_at?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          weekly_enquiry_volume?: number | null
        }
        Update: {
          access_state?: string
          access_state_reason?: string | null
          business_id?: string | null
          business_name?: string
          cancellation_requested_at?: string | null
          challenge?: string | null
          commercial_configuration_version?: number | null
          commercial_status?: string
          commercial_terms_snapshot?: Json | null
          contact_name?: string
          continuation_approved_at?: string | null
          continuation_approved_by?: string | null
          continuation_requested_at?: string | null
          duplicate_of?: string | null
          email?: string
          id?: string
          internal_notes?: string | null
          landing_page?: string | null
          last_payment_event_at?: string | null
          location?: string | null
          payment_completed_at?: string | null
          payment_invited_at?: string | null
          payment_required?: boolean
          phone?: string | null
          pilot_ends_at?: string | null
          pilot_extension_ends_at?: string | null
          pilot_started_at?: string | null
          referrer?: string | null
          renewal_prevention_attempts?: number
          renewal_prevention_confirmed?: boolean
          renewal_prevention_last_attempt_at?: string | null
          renewal_prevention_last_error?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          services?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          submitted_at?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          weekly_enquiry_volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pilot_applications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pilot_applications_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "pilot_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          annual_price_minor_units: number
          created_at: string
          currency: string
          id: string
          included_segments: number
          is_offered: boolean
          monthly_price_minor_units: number
          name: string
          overage_cents: number
          reactivation_enabled: boolean
          sort_order: number
          stripe_annual_price_id: string | null
          stripe_monthly_price_id: string | null
          tagline: string
          team_member_limit: number | null
          updated_at: string
        }
        Insert: {
          annual_price_minor_units: number
          created_at?: string
          currency?: string
          id: string
          included_segments: number
          is_offered?: boolean
          monthly_price_minor_units: number
          name: string
          overage_cents: number
          reactivation_enabled?: boolean
          sort_order?: number
          stripe_annual_price_id?: string | null
          stripe_monthly_price_id?: string | null
          tagline?: string
          team_member_limit?: number | null
          updated_at?: string
        }
        Update: {
          annual_price_minor_units?: number
          created_at?: string
          currency?: string
          id?: string
          included_segments?: number
          is_offered?: boolean
          monthly_price_minor_units?: number
          name?: string
          overage_cents?: number
          reactivation_enabled?: boolean
          sort_order?: number
          stripe_annual_price_id?: string | null
          stripe_monthly_price_id?: string | null
          tagline?: string
          team_member_limit?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          business_id: string | null
          created_at: string
          email: string | null
          id: string
          name: string | null
        }
        Insert: {
          active?: boolean
          business_id?: string | null
          created_at?: string
          email?: string | null
          id: string
          name?: string | null
        }
        Update: {
          active?: boolean
          business_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_page_events: {
        Row: {
          business_id: string
          campaign: string | null
          conversation_id: string | null
          created_at: string
          id: string
          landing_url: string | null
          medium: string | null
          referrer: string | null
          session_key: string | null
          slug: string | null
          source: string | null
          utm: Json
        }
        Insert: {
          business_id: string
          campaign?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          landing_url?: string | null
          medium?: string | null
          referrer?: string | null
          session_key?: string | null
          slug?: string | null
          source?: string | null
          utm?: Json
        }
        Update: {
          business_id?: string
          campaign?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          landing_url?: string | null
          medium?: string | null
          referrer?: string | null
          session_key?: string | null
          slug?: string | null
          source?: string | null
          utm?: Json
        }
        Relationships: [
          {
            foreignKeyName: "quote_page_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_page_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "web_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      reactivation_campaigns: {
        Row: {
          ai_notes: string | null
          approved_at: string | null
          approved_by: string | null
          attested_at: string | null
          business_id: string
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          id: string
          offer_source: string
          offer_text: string
          status: string
          updated_at: string
        }
        Insert: {
          ai_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attested_at?: string | null
          business_id: string
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          offer_source?: string
          offer_text: string
          status?: string
          updated_at?: string
        }
        Update: {
          ai_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attested_at?: string | null
          business_id?: string
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          offer_source?: string
          offer_text?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reactivation_campaigns_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      reactivation_drafts: {
        Row: {
          body: string
          business_id: string
          campaign_id: string
          created_at: string
          edited: boolean
          id: string
          lead_id: string
          message_id: string | null
          send_reason: string | null
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          body: string
          business_id: string
          campaign_id: string
          created_at?: string
          edited?: boolean
          id?: string
          lead_id: string
          message_id?: string | null
          send_reason?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          body?: string
          business_id?: string
          campaign_id?: string
          created_at?: string
          edited?: boolean
          id?: string
          lead_id?: string
          message_id?: string | null
          send_reason?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reactivation_drafts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactivation_drafts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "reactivation_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactivation_drafts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_inbox_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactivation_drafts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactivation_drafts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_campaigns: {
        Row: {
          business_id: string
          campaign_approved_at: string | null
          campaign_approved_by: string | null
          created_at: string
          disabled_at: string | null
          disabled_reason: string | null
          execution_authorisation_kind: string | null
          execution_authorised_at: string | null
          execution_authorised_by: string | null
          id: string
          lead_context: string | null
          max_leads: number
          max_recipients: number | null
          max_segments: number | null
          max_sends: number | null
          message_path: string | null
          name: string
          scope_kind: string
          scope_lead_ids: string[]
          sequence_approved_at: string | null
          sequence_approved_by: string | null
          sequence_id: string
          status: string
          template_id: string | null
          template_version: number
          updated_at: string
        }
        Insert: {
          business_id: string
          campaign_approved_at?: string | null
          campaign_approved_by?: string | null
          created_at?: string
          disabled_at?: string | null
          disabled_reason?: string | null
          execution_authorisation_kind?: string | null
          execution_authorised_at?: string | null
          execution_authorised_by?: string | null
          id?: string
          lead_context?: string | null
          max_leads?: number
          max_recipients?: number | null
          max_segments?: number | null
          max_sends?: number | null
          message_path?: string | null
          name: string
          scope_kind?: string
          scope_lead_ids?: string[]
          sequence_approved_at?: string | null
          sequence_approved_by?: string | null
          sequence_id: string
          status?: string
          template_id?: string | null
          template_version?: number
          updated_at?: string
        }
        Update: {
          business_id?: string
          campaign_approved_at?: string | null
          campaign_approved_by?: string | null
          created_at?: string
          disabled_at?: string | null
          disabled_reason?: string | null
          execution_authorisation_kind?: string | null
          execution_authorised_at?: string | null
          execution_authorised_by?: string | null
          id?: string
          lead_context?: string | null
          max_leads?: number
          max_recipients?: number | null
          max_segments?: number | null
          max_sends?: number | null
          message_path?: string | null
          name?: string
          scope_kind?: string
          scope_lead_ids?: string[]
          sequence_approved_at?: string | null
          sequence_approved_by?: string | null
          sequence_id?: string
          status?: string
          template_id?: string | null
          template_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequence_campaigns_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      service_addon_links: {
        Row: {
          addon_id: string
          business_id: string
          created_at: string
          id: string
          service_id: string
        }
        Insert: {
          addon_id: string
          business_id: string
          created_at?: string
          id?: string
          service_id: string
        }
        Update: {
          addon_id?: string
          business_id?: string
          created_at?: string
          id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_addon_links_addon_id_fkey"
            columns: ["addon_id"]
            isOneToOne: false
            referencedRelation: "service_addons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_addon_links_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_addon_links_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      service_addons: {
        Row: {
          active: boolean
          business_id: string
          category: string | null
          created_at: string
          description: string | null
          duration_minutes: number | null
          id: string
          name: string
          price_guidance: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          business_id: string
          category?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          name: string
          price_guidance?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          business_id?: string
          category?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          name?: string
          price_guidance?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_addons_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          active: boolean
          business_id: string
          campaign_eligible: boolean
          category: string | null
          created_at: string
          description: string | null
          duration_minutes: number | null
          excluded_items: string | null
          id: string
          included_items: string | null
          name: string
          price_guidance: string | null
          qualification_note: string | null
        }
        Insert: {
          active?: boolean
          business_id: string
          campaign_eligible?: boolean
          category?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          excluded_items?: string | null
          id?: string
          included_items?: string | null
          name: string
          price_guidance?: string | null
          qualification_note?: string | null
        }
        Update: {
          active?: boolean
          business_id?: string
          campaign_eligible?: boolean
          category?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          excluded_items?: string | null
          id?: string
          included_items?: string | null
          name?: string
          price_guidance?: string | null
          qualification_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "services_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_senders: {
        Row: {
          active: boolean
          business_id: string | null
          created_at: string
          credential_mode: string
          credential_secret_name: string | null
          id: string
          is_primary: boolean
          label: string | null
          messaging_profile_id: string | null
          phone_number: string
          provider: string
          status_callback_url: string | null
          subaccount_sid: string | null
          texto_account_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          business_id?: string | null
          created_at?: string
          credential_mode?: string
          credential_secret_name?: string | null
          id?: string
          is_primary?: boolean
          label?: string | null
          messaging_profile_id?: string | null
          phone_number: string
          provider?: string
          status_callback_url?: string | null
          subaccount_sid?: string | null
          texto_account_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          business_id?: string | null
          created_at?: string
          credential_mode?: string
          credential_secret_name?: string | null
          id?: string
          is_primary?: boolean
          label?: string | null
          messaging_profile_id?: string | null
          phone_number?: string
          provider?: string
          status_callback_url?: string | null
          subaccount_sid?: string | null
          texto_account_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_senders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_senders_texto_account_id_fkey"
            columns: ["texto_account_id"]
            isOneToOne: false
            referencedRelation: "texto_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_usage_daily: {
        Row: {
          business_id: string
          created_at: string
          failures: number
          id: string
          messages_out: number
          provider_cost: number
          retail_charge: number
          segments_in: number
          segments_out: number
          updated_at: string
          usage_date: string
        }
        Insert: {
          business_id: string
          created_at?: string
          failures?: number
          id?: string
          messages_out?: number
          provider_cost?: number
          retail_charge?: number
          segments_in?: number
          segments_out?: number
          updated_at?: string
          usage_date?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          failures?: number
          id?: string
          messages_out?: number
          provider_cost?: number
          retail_charge?: number
          segments_in?: number
          segments_out?: number
          updated_at?: string
          usage_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_usage_daily_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_usage_periods: {
        Row: {
          business_id: string | null
          created_at: string
          hard_cap_reached_at: string | null
          id: string
          included_segments: number
          period_end: string
          period_start: string
          pilot_application_id: string
          segments_blocked: number
          segments_used: number
          updated_at: string
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          hard_cap_reached_at?: string | null
          id?: string
          included_segments?: number
          period_end: string
          period_start: string
          pilot_application_id: string
          segments_blocked?: number
          segments_used?: number
          updated_at?: string
        }
        Update: {
          business_id?: string | null
          created_at?: string
          hard_cap_reached_at?: string | null
          id?: string
          included_segments?: number
          period_end?: string
          period_start?: string
          pilot_application_id?: string
          segments_blocked?: number
          segments_used?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_usage_periods_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_usage_periods_pilot_application_id_fkey"
            columns: ["pilot_application_id"]
            isOneToOne: false
            referencedRelation: "pilot_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_events: {
        Row: {
          event_type: string
          id: string
          payload_reference: Json | null
          processed_at: string | null
          processing_error: string | null
          processing_status: string
          received_at: string
          stripe_event_id: string
        }
        Insert: {
          event_type: string
          id?: string
          payload_reference?: Json | null
          processed_at?: string | null
          processing_error?: string | null
          processing_status?: string
          received_at?: string
          stripe_event_id: string
        }
        Update: {
          event_type?: string
          id?: string
          payload_reference?: Json | null
          processed_at?: string | null
          processing_error?: string | null
          processing_status?: string
          received_at?: string
          stripe_event_id?: string
        }
        Relationships: []
      }
      tenant_requests: {
        Row: {
          business_id: string
          created_at: string
          id: string
          kind: string
          note: string | null
          requested_by: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          kind: string
          note?: string | null
          requested_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          kind?: string
          note?: string | null
          requested_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_requests_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      texto_accounts: {
        Row: {
          allocated_credits: number
          business_id: string
          created_at: string
          credit_balance: number
          daily_send_cap: number
          failed_reason: string | null
          id: string
          provider: string
          provisioned_at: string | null
          provisioning_state: string
          subaccount_id: string | null
          subaccount_reference: string | null
          updated_at: string
        }
        Insert: {
          allocated_credits?: number
          business_id: string
          created_at?: string
          credit_balance?: number
          daily_send_cap?: number
          failed_reason?: string | null
          id?: string
          provider?: string
          provisioned_at?: string | null
          provisioning_state?: string
          subaccount_id?: string | null
          subaccount_reference?: string | null
          updated_at?: string
        }
        Update: {
          allocated_credits?: number
          business_id?: string
          created_at?: string
          credit_balance?: number
          daily_send_cap?: number
          failed_reason?: string | null
          id?: string
          provider?: string
          provisioned_at?: string | null
          provisioning_state?: string
          subaccount_id?: string | null
          subaccount_reference?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "texto_accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      texto_numbers: {
        Row: {
          assigned_at: string | null
          assigned_business_id: string | null
          created_at: string
          id: string
          monthly_cost_cents: number
          number: string
          provider: string
          provider_number_id: string | null
          recalled_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_business_id?: string | null
          created_at?: string
          id?: string
          monthly_cost_cents?: number
          number: string
          provider?: string
          provider_number_id?: string | null
          recalled_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string | null
          assigned_business_id?: string | null
          created_at?: string
          id?: string
          monthly_cost_cents?: number
          number?: string
          provider?: string
          provider_number_id?: string | null
          recalled_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "texto_numbers_assigned_business_id_fkey"
            columns: ["assigned_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_limits: {
        Row: {
          alert_threshold_pct: number
          business_id: string
          created_at: string
          hard_block: boolean
          id: string
          last_alert_sent_at: string | null
          monthly_ai_cost_cap: number
          monthly_segment_cap: number
          updated_at: string
        }
        Insert: {
          alert_threshold_pct?: number
          business_id: string
          created_at?: string
          hard_block?: boolean
          id?: string
          last_alert_sent_at?: string | null
          monthly_ai_cost_cap?: number
          monthly_segment_cap?: number
          updated_at?: string
        }
        Update: {
          alert_threshold_pct?: number
          business_id?: string
          created_at?: string
          hard_block?: boolean
          id?: string
          last_alert_sent_at?: string | null
          monthly_ai_cost_cap?: number
          monthly_segment_cap?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_limits_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      web_conversation_messages: {
        Row: {
          body: string
          business_id: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          body: string
          business_id: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          body?: string
          business_id?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_conversation_messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "web_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      web_conversations: {
        Row: {
          abandoned_at: string | null
          business_id: string
          collected: Json
          completed_at: string | null
          consent_outcome: string | null
          created_at: string
          id: string
          last_activity_at: string
          lead_id: string | null
          mobile_captured_at: string | null
          requires_owner_review: boolean
          selected_service_id: string | null
          service_name_snapshot: string | null
          status: string
          unsupported_request: string | null
          updated_at: string
        }
        Insert: {
          abandoned_at?: string | null
          business_id: string
          collected?: Json
          completed_at?: string | null
          consent_outcome?: string | null
          created_at?: string
          id?: string
          last_activity_at?: string
          lead_id?: string | null
          mobile_captured_at?: string | null
          requires_owner_review?: boolean
          selected_service_id?: string | null
          service_name_snapshot?: string | null
          status?: string
          unsupported_request?: string | null
          updated_at?: string
        }
        Update: {
          abandoned_at?: string | null
          business_id?: string
          collected?: Json
          completed_at?: string | null
          consent_outcome?: string | null
          created_at?: string
          id?: string
          last_activity_at?: string
          lead_id?: string | null
          mobile_captured_at?: string | null
          requires_owner_review?: boolean
          selected_service_id?: string | null
          service_name_snapshot?: string | null
          status?: string
          unsupported_request?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_conversations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead_inbox_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_conversations_selected_service_id_fkey"
            columns: ["selected_service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          business_id: string | null
          created_at: string
          event_id: string
          event_type: string | null
          id: string
          payload: Json | null
          processed_at: string | null
          processing_error: string | null
          processing_started_at: string | null
          provider: string
          signature_verified: boolean | null
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          event_id: string
          event_type?: string | null
          id?: string
          payload?: Json | null
          processed_at?: string | null
          processing_error?: string | null
          processing_started_at?: string | null
          provider: string
          signature_verified?: boolean | null
        }
        Update: {
          business_id?: string | null
          created_at?: string
          event_id?: string
          event_type?: string | null
          id?: string
          payload?: Json | null
          processed_at?: string | null
          processing_error?: string | null
          processing_started_at?: string | null
          provider?: string
          signature_verified?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      lead_inbox_rows: {
        Row: {
          business_id: string | null
          conversation_automation_paused: boolean | null
          conversation_id: string | null
          conversation_last_message_at: string | null
          conversation_next_follow_up_at: string | null
          conversation_status: string | null
          created_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
          deletion_request_id: string | null
          email: string | null
          first_contacted_at: string | null
          first_reply_at: string | null
          id: string | null
          import_batch_id: string | null
          job_completed_value: number | null
          job_completion_status: string | null
          job_id: string | null
          last_activity_at: string | null
          last_delivered_sms_at: string | null
          last_inbound_reply_at: string | null
          last_outbound_sms_at: string | null
          last_outbound_sms_status: string | null
          last_permanent_failure_at: string | null
          last_reply_at: string | null
          last_sms_failure_at: string | null
          last_sms_failure_code: string | null
          last_sms_failure_reason: string | null
          last_successful_delivery_at: string | null
          lead_origin: string | null
          mobile_number: string | null
          name: string | null
          reachability_evidence: string | null
          reachability_evidence_at: string | null
          reachability_state: string | null
          readiness_classification: string | null
          service_address: string | null
          service_intent: string | null
          sms_suppressed_at: string | null
          sms_suppression_reason: string | null
          source_campaign: string | null
          source_channel: string | null
          source_metadata: Json | null
          status: string | null
          suburb: string | null
          updated_at: string | null
          vehicle_type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_set_profile_assignment: {
        Args: {
          p_active?: boolean
          p_business_id: string
          p_profile_id: string
        }
        Returns: {
          active: boolean
          business_id: string | null
          created_at: string
          email: string | null
          id: string
          name: string | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      commit_web_chat_booking: {
        Args: {
          p_business_id: string
          p_idempotency_key: string
          p_lead_id: string
          p_offer_id: string
        }
        Returns: Json
      }
      record_blocked_sms_segments: {
        Args: { p_period_id: string; p_segments: number }
        Returns: undefined
      }
      release_sms_segments: {
        Args: { p_period_id: string; p_segments: number }
        Returns: undefined
      }
      reserve_sms_segments: {
        Args: { p_period_id: string; p_segments: number }
        Returns: {
          business_id: string | null
          created_at: string
          hard_cap_reached_at: string | null
          id: string
          included_segments: number
          period_end: string
          period_start: string
          pilot_application_id: string
          segments_blocked: number
          segments_used: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sms_usage_periods"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_cron_credential: {
        Args: { p_name: string; p_secret: string }
        Returns: undefined
      }
      sweep_abandoned_web_conversations: {
        Args: { p_minutes?: number }
        Returns: number
      }
    }
    Enums: {
      app_role: "owner" | "staff" | "platform_admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "staff", "platform_admin"],
    },
  },
} as const
