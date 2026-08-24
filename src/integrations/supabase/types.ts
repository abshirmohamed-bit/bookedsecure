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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
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
            referencedRelation: "leads"
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
      businesses: {
        Row: {
          automation_enabled: boolean
          created_at: string
          default_sms_provider: string
          id: string
          name: string
          opening_hours: string | null
          phone_number: string | null
          privacy_policy_url: string | null
          quiet_hours_end: number
          quiet_hours_start: number
          service_area: string | null
          sms_credential_mode: string
          sms_signature: string | null
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          automation_enabled?: boolean
          created_at?: string
          default_sms_provider?: string
          id?: string
          name: string
          opening_hours?: string | null
          phone_number?: string | null
          privacy_policy_url?: string | null
          quiet_hours_end?: number
          quiet_hours_start?: number
          service_area?: string | null
          sms_credential_mode?: string
          sms_signature?: string | null
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          automation_enabled?: boolean
          created_at?: string
          default_sms_provider?: string
          id?: string
          name?: string
          opening_hours?: string | null
          phone_number?: string | null
          privacy_policy_url?: string | null
          quiet_hours_end?: number
          quiet_hours_start?: number
          service_area?: string | null
          sms_credential_mode?: string
          sms_signature?: string | null
          status?: string
          timezone?: string
          updated_at?: string
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
            referencedRelation: "leads"
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
      leads: {
        Row: {
          assigned_to: string | null
          business_id: string
          consent_record: Json | null
          created_at: string
          email: string | null
          first_contacted_at: string | null
          first_reply_at: string | null
          id: string
          last_cleaned_at: string | null
          main_concerns: string | null
          mobile_number: string
          name: string
          notes: string | null
          opted_out_at: string | null
          readiness_classification: string | null
          service_intent: string | null
          source_campaign: string | null
          source_channel: string
          source_form: string | null
          status: string
          suburb: string | null
          updated_at: string
          utm_campaign: string | null
          utm_source: string | null
          vehicle_type: string | null
        }
        Insert: {
          assigned_to?: string | null
          business_id: string
          consent_record?: Json | null
          created_at?: string
          email?: string | null
          first_contacted_at?: string | null
          first_reply_at?: string | null
          id?: string
          last_cleaned_at?: string | null
          main_concerns?: string | null
          mobile_number: string
          name: string
          notes?: string | null
          opted_out_at?: string | null
          readiness_classification?: string | null
          service_intent?: string | null
          source_campaign?: string | null
          source_channel?: string
          source_form?: string | null
          status?: string
          suburb?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_source?: string | null
          vehicle_type?: string | null
        }
        Update: {
          assigned_to?: string | null
          business_id?: string
          consent_record?: Json | null
          created_at?: string
          email?: string | null
          first_contacted_at?: string | null
          first_reply_at?: string | null
          id?: string
          last_cleaned_at?: string | null
          main_concerns?: string | null
          mobile_number?: string
          name?: string
          notes?: string | null
          opted_out_at?: string | null
          readiness_classification?: string | null
          service_intent?: string | null
          source_campaign?: string | null
          source_channel?: string
          source_form?: string | null
          status?: string
          suburb?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_source?: string | null
          vehicle_type?: string | null
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
      messages: {
        Row: {
          attempt_count: number
          body: string
          business_id: string
          conversation_id: string | null
          created_at: string
          delivery_status: string
          direction: string
          error_code: string | null
          from_number: string | null
          id: string
          idempotency_key: string | null
          lead_id: string
          message_kind: string
          next_retry_at: string | null
          provider: string | null
          provider_cost: number | null
          provider_message_id: string | null
          received_at: string | null
          segments: number
          sender_id: string | null
          sent_at: string | null
        }
        Insert: {
          attempt_count?: number
          body: string
          business_id: string
          conversation_id?: string | null
          created_at?: string
          delivery_status?: string
          direction: string
          error_code?: string | null
          from_number?: string | null
          id?: string
          idempotency_key?: string | null
          lead_id: string
          message_kind?: string
          next_retry_at?: string | null
          provider?: string | null
          provider_cost?: number | null
          provider_message_id?: string | null
          received_at?: string | null
          segments?: number
          sender_id?: string | null
          sent_at?: string | null
        }
        Update: {
          attempt_count?: number
          body?: string
          business_id?: string
          conversation_id?: string | null
          created_at?: string
          delivery_status?: string
          direction?: string
          error_code?: string | null
          from_number?: string | null
          id?: string
          idempotency_key?: string | null
          lead_id?: string
          message_kind?: string
          next_retry_at?: string | null
          provider?: string | null
          provider_cost?: number | null
          provider_message_id?: string | null
          received_at?: string | null
          segments?: number
          sender_id?: string | null
          sent_at?: string | null
        }
        Relationships: [
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
      services: {
        Row: {
          active: boolean
          business_id: string
          created_at: string
          description: string | null
          excluded_items: string | null
          id: string
          included_items: string | null
          name: string
          price_guidance: string | null
        }
        Insert: {
          active?: boolean
          business_id: string
          created_at?: string
          description?: string | null
          excluded_items?: string | null
          id?: string
          included_items?: string | null
          name: string
          price_guidance?: string | null
        }
        Update: {
          active?: boolean
          business_id?: string
          created_at?: string
          description?: string | null
          excluded_items?: string | null
          id?: string
          included_items?: string | null
          name?: string
          price_guidance?: string | null
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
          business_id: string
          created_at: string
          credential_mode: string
          credential_secret_name: string | null
          id: string
          is_primary: boolean
          label: string | null
          phone_number: string
          provider: string
          status_callback_url: string | null
          subaccount_sid: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          business_id: string
          created_at?: string
          credential_mode?: string
          credential_secret_name?: string | null
          id?: string
          is_primary?: boolean
          label?: string | null
          phone_number: string
          provider?: string
          status_callback_url?: string | null
          subaccount_sid?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          business_id?: string
          created_at?: string
          credential_mode?: string
          credential_secret_name?: string | null
          id?: string
          is_primary?: boolean
          label?: string | null
          phone_number?: string
          provider?: string
          status_callback_url?: string | null
          subaccount_sid?: string | null
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
      webhook_events: {
        Row: {
          business_id: string | null
          created_at: string
          event_id: string
          event_type: string | null
          id: string
          payload: Json | null
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
      [_ in never]: never
    }
    Functions: {
      current_business_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
