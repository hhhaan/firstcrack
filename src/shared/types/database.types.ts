export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
    // Allows to automatically instantiate createClient with right options
    // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
    __InternalSupabase: {
        PostgrestVersion: '14.5';
    };
    graphql_public: {
        Tables: {
            [_ in never]: never;
        };
        Views: {
            [_ in never]: never;
        };
        Functions: {
            graphql: {
                Args: {
                    extensions?: Json;
                    operationName?: string;
                    query?: string;
                    variables?: Json;
                };
                Returns: Json;
            };
        };
        Enums: {
            [_ in never]: never;
        };
        CompositeTypes: {
            [_ in never]: never;
        };
    };
    public: {
        Tables: {
            bean_stock_events: {
                Row: {
                    bean_id: string;
                    cost_per_kg: number | null;
                    created_at: string;
                    created_by: string | null;
                    delta_grams: number;
                    event_type: string;
                    id: string;
                    note: string | null;
                    reference_id: string | null;
                    user_id: string;
                };
                Insert: {
                    bean_id: string;
                    cost_per_kg?: number | null;
                    created_at?: string;
                    created_by?: string | null;
                    delta_grams: number;
                    event_type: string;
                    id?: string;
                    note?: string | null;
                    reference_id?: string | null;
                    user_id: string;
                };
                Update: {
                    bean_id?: string;
                    cost_per_kg?: number | null;
                    created_at?: string;
                    created_by?: string | null;
                    delta_grams?: number;
                    event_type?: string;
                    id?: string;
                    note?: string | null;
                    reference_id?: string | null;
                    user_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'bean_stock_events_bean_id_fkey';
                        columns: ['bean_id'];
                        isOneToOne: false;
                        referencedRelation: 'beans';
                        referencedColumns: ['id'];
                    },
                ];
            };
            beans: {
                Row: {
                    altitude_masl: number | null;
                    capacity_grams: number;
                    cost_per_kg: number | null;
                    created_at: string;
                    farm: string | null;
                    id: string;
                    low_stock_threshold_grams: number;
                    name: string;
                    origin: string | null;
                    process: string | null;
                    purchase_date: string | null;
                    region: string | null;
                    tasting_notes: string | null;
                    updated_at: string;
                    user_id: string;
                    variety: string | null;
                    vendor: string | null;
                };
                Insert: {
                    altitude_masl?: number | null;
                    capacity_grams?: number;
                    cost_per_kg?: number | null;
                    created_at?: string;
                    farm?: string | null;
                    id?: string;
                    low_stock_threshold_grams?: number;
                    name: string;
                    origin?: string | null;
                    process?: string | null;
                    purchase_date?: string | null;
                    region?: string | null;
                    tasting_notes?: string | null;
                    updated_at?: string;
                    user_id: string;
                    variety?: string | null;
                    vendor?: string | null;
                };
                Update: {
                    altitude_masl?: number | null;
                    capacity_grams?: number;
                    cost_per_kg?: number | null;
                    created_at?: string;
                    farm?: string | null;
                    id?: string;
                    low_stock_threshold_grams?: number;
                    name?: string;
                    origin?: string | null;
                    process?: string | null;
                    purchase_date?: string | null;
                    region?: string | null;
                    tasting_notes?: string | null;
                    updated_at?: string;
                    user_id?: string;
                    variety?: string | null;
                    vendor?: string | null;
                };
                Relationships: [
                    {
                        foreignKeyName: 'beans_user_id_fkey';
                        columns: ['user_id'];
                        isOneToOne: false;
                        referencedRelation: 'profiles';
                        referencedColumns: ['id'];
                    },
                ];
            };
            blend_components: {
                Row: {
                    bean_id: string;
                    blend_id: string;
                    id: string;
                    ratio_pct: number;
                };
                Insert: {
                    bean_id: string;
                    blend_id: string;
                    id?: string;
                    ratio_pct: number;
                };
                Update: {
                    bean_id?: string;
                    blend_id?: string;
                    id?: string;
                    ratio_pct?: number;
                };
                Relationships: [
                    {
                        foreignKeyName: 'blend_components_bean_id_fkey';
                        columns: ['bean_id'];
                        isOneToOne: false;
                        referencedRelation: 'beans';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'blend_components_blend_id_fkey';
                        columns: ['blend_id'];
                        isOneToOne: false;
                        referencedRelation: 'blends';
                        referencedColumns: ['id'];
                    },
                ];
            };
            blends: {
                Row: {
                    created_at: string;
                    description: string | null;
                    id: string;
                    name: string;
                    updated_at: string;
                    user_id: string;
                };
                Insert: {
                    created_at?: string;
                    description?: string | null;
                    id?: string;
                    name: string;
                    updated_at?: string;
                    user_id: string;
                };
                Update: {
                    created_at?: string;
                    description?: string | null;
                    id?: string;
                    name?: string;
                    updated_at?: string;
                    user_id?: string;
                };
                Relationships: [];
            };
            cupping_events: {
                Row: {
                    created_at: string;
                    ended_at: string | null;
                    form_snapshot: Json;
                    form_template_id: string | null;
                    held_at: string;
                    id: string;
                    notes: string | null;
                    results_token: string | null;
                    title: string;
                    updated_at: string;
                    user_id: string;
                };
                Insert: {
                    created_at?: string;
                    ended_at?: string | null;
                    form_snapshot?: Json;
                    form_template_id?: string | null;
                    held_at?: string;
                    id?: string;
                    notes?: string | null;
                    results_token?: string | null;
                    title: string;
                    updated_at?: string;
                    user_id: string;
                };
                Update: {
                    created_at?: string;
                    ended_at?: string | null;
                    form_snapshot?: Json;
                    form_template_id?: string | null;
                    held_at?: string;
                    id?: string;
                    notes?: string | null;
                    results_token?: string | null;
                    title?: string;
                    updated_at?: string;
                    user_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'cupping_events_form_template_id_fkey';
                        columns: ['form_template_id'];
                        isOneToOne: false;
                        referencedRelation: 'cupping_form_templates';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'cupping_events_user_id_fkey';
                        columns: ['user_id'];
                        isOneToOne: false;
                        referencedRelation: 'profiles';
                        referencedColumns: ['id'];
                    },
                ];
            };
            cupping_form_templates: {
                Row: {
                    created_at: string;
                    id: string;
                    name: string;
                    schema: Json;
                    updated_at: string;
                    user_id: string;
                };
                Insert: {
                    created_at?: string;
                    id?: string;
                    name: string;
                    schema: Json;
                    updated_at?: string;
                    user_id: string;
                };
                Update: {
                    created_at?: string;
                    id?: string;
                    name?: string;
                    schema?: Json;
                    updated_at?: string;
                    user_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'cupping_form_templates_user_id_fkey';
                        columns: ['user_id'];
                        isOneToOne: false;
                        referencedRelation: 'profiles';
                        referencedColumns: ['id'];
                    },
                ];
            };
            cupping_invites: {
                Row: {
                    created_at: string;
                    event_id: string | null;
                    expires_at: string;
                    id: string;
                    label: string | null;
                    max_uses: number;
                    revoked_at: string | null;
                    roast_session_id: string | null;
                    sample_id: string | null;
                    token: string;
                    used_count: number;
                    user_id: string;
                };
                Insert: {
                    created_at?: string;
                    event_id?: string | null;
                    expires_at: string;
                    id?: string;
                    label?: string | null;
                    max_uses?: number;
                    revoked_at?: string | null;
                    roast_session_id?: string | null;
                    sample_id?: string | null;
                    token: string;
                    used_count?: number;
                    user_id: string;
                };
                Update: {
                    created_at?: string;
                    event_id?: string | null;
                    expires_at?: string;
                    id?: string;
                    label?: string | null;
                    max_uses?: number;
                    revoked_at?: string | null;
                    roast_session_id?: string | null;
                    sample_id?: string | null;
                    token?: string;
                    used_count?: number;
                    user_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'cupping_invites_event_id_fkey';
                        columns: ['event_id'];
                        isOneToOne: false;
                        referencedRelation: 'cupping_events';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'cupping_invites_roast_session_id_fkey';
                        columns: ['roast_session_id'];
                        isOneToOne: false;
                        referencedRelation: 'roast_sessions';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'cupping_invites_sample_id_fkey';
                        columns: ['sample_id'];
                        isOneToOne: false;
                        referencedRelation: 'cupping_samples';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'cupping_invites_user_id_fkey';
                        columns: ['user_id'];
                        isOneToOne: false;
                        referencedRelation: 'profiles';
                        referencedColumns: ['id'];
                    },
                ];
            };
            cupping_participants: {
                Row: {
                    claimed_at: string;
                    created_at: string;
                    cupped_by: string;
                    id: string;
                    invite_id: string;
                    published_at: string | null;
                    user_id: string;
                };
                Insert: {
                    claimed_at?: string;
                    created_at?: string;
                    cupped_by: string;
                    id?: string;
                    invite_id: string;
                    published_at?: string | null;
                    user_id: string;
                };
                Update: {
                    claimed_at?: string;
                    created_at?: string;
                    cupped_by?: string;
                    id?: string;
                    invite_id?: string;
                    published_at?: string | null;
                    user_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'cupping_participants_invite_id_fkey';
                        columns: ['invite_id'];
                        isOneToOne: false;
                        referencedRelation: 'cupping_invites';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'cupping_participants_user_id_fkey';
                        columns: ['user_id'];
                        isOneToOne: false;
                        referencedRelation: 'profiles';
                        referencedColumns: ['id'];
                    },
                ];
            };
            cupping_samples: {
                Row: {
                    created_at: string;
                    event_id: string;
                    id: string;
                    label: string;
                    roast_session_id: string | null;
                    sort_order: number;
                    user_id: string;
                };
                Insert: {
                    created_at?: string;
                    event_id: string;
                    id?: string;
                    label: string;
                    roast_session_id?: string | null;
                    sort_order?: number;
                    user_id: string;
                };
                Update: {
                    created_at?: string;
                    event_id?: string;
                    id?: string;
                    label?: string;
                    roast_session_id?: string | null;
                    sort_order?: number;
                    user_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'cupping_samples_event_id_fkey';
                        columns: ['event_id'];
                        isOneToOne: false;
                        referencedRelation: 'cupping_events';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'cupping_samples_roast_session_id_fkey';
                        columns: ['roast_session_id'];
                        isOneToOne: false;
                        referencedRelation: 'roast_sessions';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'cupping_samples_user_id_fkey';
                        columns: ['user_id'];
                        isOneToOne: false;
                        referencedRelation: 'profiles';
                        referencedColumns: ['id'];
                    },
                ];
            };
            cuppings: {
                Row: {
                    created_at: string;
                    cupped_at: string;
                    cupped_by: string | null;
                    defects: number;
                    descriptors: string[];
                    form_version: string;
                    id: string;
                    invite_id: string | null;
                    notes: string | null;
                    roast_profile_id: string | null;
                    roast_session_id: string | null;
                    sample_id: string | null;
                    scores: Json;
                    source: string;
                    total_score: number;
                    updated_at: string;
                    user_id: string;
                };
                Insert: {
                    created_at?: string;
                    cupped_at?: string;
                    cupped_by?: string | null;
                    defects?: number;
                    descriptors?: string[];
                    form_version?: string;
                    id?: string;
                    invite_id?: string | null;
                    notes?: string | null;
                    roast_profile_id?: string | null;
                    roast_session_id?: string | null;
                    sample_id?: string | null;
                    scores: Json;
                    source?: string;
                    total_score: number;
                    updated_at?: string;
                    user_id: string;
                };
                Update: {
                    created_at?: string;
                    cupped_at?: string;
                    cupped_by?: string | null;
                    defects?: number;
                    descriptors?: string[];
                    form_version?: string;
                    id?: string;
                    invite_id?: string | null;
                    notes?: string | null;
                    roast_profile_id?: string | null;
                    roast_session_id?: string | null;
                    sample_id?: string | null;
                    scores?: Json;
                    source?: string;
                    total_score?: number;
                    updated_at?: string;
                    user_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'cuppings_invite_id_fkey';
                        columns: ['invite_id'];
                        isOneToOne: false;
                        referencedRelation: 'cupping_invites';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'cuppings_roast_profile_id_fkey';
                        columns: ['roast_profile_id'];
                        isOneToOne: false;
                        referencedRelation: 'roast_profiles';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'cuppings_roast_session_id_fkey';
                        columns: ['roast_session_id'];
                        isOneToOne: false;
                        referencedRelation: 'roast_sessions';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'cuppings_sample_id_fkey';
                        columns: ['sample_id'];
                        isOneToOne: false;
                        referencedRelation: 'cupping_samples';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'cuppings_user_id_fkey';
                        columns: ['user_id'];
                        isOneToOne: false;
                        referencedRelation: 'profiles';
                        referencedColumns: ['id'];
                    },
                ];
            };
            inventory_alert_runs: {
                Row: {
                    error_message: string | null;
                    finished_at: string | null;
                    id: string;
                    started_at: string;
                    status: string;
                    users_processed: number;
                };
                Insert: {
                    error_message?: string | null;
                    finished_at?: string | null;
                    id?: string;
                    started_at?: string;
                    status?: string;
                    users_processed?: number;
                };
                Update: {
                    error_message?: string | null;
                    finished_at?: string | null;
                    id?: string;
                    started_at?: string;
                    status?: string;
                    users_processed?: number;
                };
                Relationships: [];
            };
            inventory_alerts: {
                Row: {
                    available_grams: number;
                    bean_id: string;
                    computed_at: string;
                    current_grams: number;
                    dismissed_at: string | null;
                    effective_grams: number;
                    horizon_days: number;
                    id: string;
                    reason: string;
                    reserved_grams: number;
                    user_id: string;
                };
                Insert: {
                    available_grams: number;
                    bean_id: string;
                    computed_at?: string;
                    current_grams: number;
                    dismissed_at?: string | null;
                    effective_grams: number;
                    horizon_days?: number;
                    id?: string;
                    reason: string;
                    reserved_grams: number;
                    user_id: string;
                };
                Update: {
                    available_grams?: number;
                    bean_id?: string;
                    computed_at?: string;
                    current_grams?: number;
                    dismissed_at?: string | null;
                    effective_grams?: number;
                    horizon_days?: number;
                    id?: string;
                    reason?: string;
                    reserved_grams?: number;
                    user_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'inventory_alerts_bean_id_fkey';
                        columns: ['bean_id'];
                        isOneToOne: false;
                        referencedRelation: 'beans';
                        referencedColumns: ['id'];
                    },
                ];
            };
            machine_connection_logs: {
                Row: {
                    brand: string;
                    created_at: string;
                    display_name: string;
                    duration_sec: number | null;
                    error_message: string | null;
                    id: string;
                    machine_id: string | null;
                    params: Json | null;
                    protocol: string;
                    roaster_key: string;
                    success: boolean;
                    user_id: string;
                };
                Insert: {
                    brand?: string;
                    created_at?: string;
                    display_name?: string;
                    duration_sec?: number | null;
                    error_message?: string | null;
                    id?: string;
                    machine_id?: string | null;
                    params?: Json | null;
                    protocol: string;
                    roaster_key: string;
                    success?: boolean;
                    user_id: string;
                };
                Update: {
                    brand?: string;
                    created_at?: string;
                    display_name?: string;
                    duration_sec?: number | null;
                    error_message?: string | null;
                    id?: string;
                    machine_id?: string | null;
                    params?: Json | null;
                    protocol?: string;
                    roaster_key?: string;
                    success?: boolean;
                    user_id?: string;
                };
                Relationships: [];
            };
            market_roastery_contacts: {
                Row: {
                    contacted: boolean;
                    contacted_at: string;
                    roastery_id: string;
                    updated_at: string;
                };
                Insert: {
                    contacted?: boolean;
                    contacted_at?: string;
                    roastery_id: string;
                    updated_at?: string;
                };
                Update: {
                    contacted?: boolean;
                    contacted_at?: string;
                    roastery_id?: string;
                    updated_at?: string;
                };
                Relationships: [];
            };
            market_roastery_hidden: {
                Row: {
                    hidden_at: string;
                    roastery_id: string;
                };
                Insert: {
                    hidden_at?: string;
                    roastery_id: string;
                };
                Update: {
                    hidden_at?: string;
                    roastery_id?: string;
                };
                Relationships: [];
            };
            order_dispatches: {
                Row: {
                    attempt_count: number;
                    carrier: string;
                    confirmed_at: string | null;
                    connection_id: string;
                    created_by: string | null;
                    id: string;
                    last_error: string | null;
                    line_results: Json | null;
                    order_id: string;
                    requested_at: string;
                    sent_at: string | null;
                    status: string;
                    tracking_number: string;
                    updated_at: string;
                    user_id: string;
                };
                Insert: {
                    attempt_count?: number;
                    carrier: string;
                    confirmed_at?: string | null;
                    connection_id: string;
                    created_by?: string | null;
                    id?: string;
                    last_error?: string | null;
                    line_results?: Json | null;
                    order_id: string;
                    requested_at?: string;
                    sent_at?: string | null;
                    status?: string;
                    tracking_number: string;
                    updated_at?: string;
                    user_id: string;
                };
                Update: {
                    attempt_count?: number;
                    carrier?: string;
                    confirmed_at?: string | null;
                    connection_id?: string;
                    created_by?: string | null;
                    id?: string;
                    last_error?: string | null;
                    line_results?: Json | null;
                    order_id?: string;
                    requested_at?: string;
                    sent_at?: string | null;
                    status?: string;
                    tracking_number?: string;
                    updated_at?: string;
                    user_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'order_dispatches_connection_id_fkey';
                        columns: ['connection_id'];
                        isOneToOne: false;
                        referencedRelation: 'sales_channel_connections';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'order_dispatches_order_id_fkey';
                        columns: ['order_id'];
                        isOneToOne: false;
                        referencedRelation: 'orders';
                        referencedColumns: ['id'];
                    },
                ];
            };
            order_lines: {
                Row: {
                    created_at: string;
                    id: string;
                    order_id: string;
                    platform_line_id: string;
                    platform_product_id: string | null;
                    platform_variant_id: string | null;
                    product_id: string | null;
                    quantity: number;
                    status: string;
                    title: string;
                    unit_price: number | null;
                    user_id: string;
                };
                Insert: {
                    created_at?: string;
                    id?: string;
                    order_id: string;
                    platform_line_id: string;
                    platform_product_id?: string | null;
                    platform_variant_id?: string | null;
                    product_id?: string | null;
                    quantity: number;
                    status?: string;
                    title: string;
                    unit_price?: number | null;
                    user_id: string;
                };
                Update: {
                    created_at?: string;
                    id?: string;
                    order_id?: string;
                    platform_line_id?: string;
                    platform_product_id?: string | null;
                    platform_variant_id?: string | null;
                    product_id?: string | null;
                    quantity?: number;
                    status?: string;
                    title?: string;
                    unit_price?: number | null;
                    user_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'order_lines_order_id_fkey';
                        columns: ['order_id'];
                        isOneToOne: false;
                        referencedRelation: 'orders';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'order_lines_product_id_fkey';
                        columns: ['product_id'];
                        isOneToOne: false;
                        referencedRelation: 'products';
                        referencedColumns: ['id'];
                    },
                ];
            };
            order_sync_runs: {
                Row: {
                    connection_id: string | null;
                    error_message: string | null;
                    external_event_id: string | null;
                    finished_at: string | null;
                    id: string;
                    orders_upserted: number;
                    started_at: string;
                    status: string;
                    trigger: string;
                    user_id: string | null;
                };
                Insert: {
                    connection_id?: string | null;
                    error_message?: string | null;
                    external_event_id?: string | null;
                    finished_at?: string | null;
                    id?: string;
                    orders_upserted?: number;
                    started_at?: string;
                    status?: string;
                    trigger?: string;
                    user_id?: string | null;
                };
                Update: {
                    connection_id?: string | null;
                    error_message?: string | null;
                    external_event_id?: string | null;
                    finished_at?: string | null;
                    id?: string;
                    orders_upserted?: number;
                    started_at?: string;
                    status?: string;
                    trigger?: string;
                    user_id?: string | null;
                };
                Relationships: [
                    {
                        foreignKeyName: 'order_sync_runs_connection_id_fkey';
                        columns: ['connection_id'];
                        isOneToOne: false;
                        referencedRelation: 'sales_channel_connections';
                        referencedColumns: ['id'];
                    },
                ];
            };
            orders: {
                Row: {
                    buyer_name: string | null;
                    connection_id: string | null;
                    created_at: string;
                    currency: string | null;
                    fulfilled_at: string | null;
                    id: string;
                    ordered_at: string;
                    platform: string;
                    platform_order_id: string;
                    raw: Json | null;
                    status: string;
                    synced_at: string | null;
                    total_amount: number | null;
                    updated_at: string;
                    user_id: string;
                };
                Insert: {
                    buyer_name?: string | null;
                    connection_id?: string | null;
                    created_at?: string;
                    currency?: string | null;
                    fulfilled_at?: string | null;
                    id?: string;
                    ordered_at: string;
                    platform: string;
                    platform_order_id: string;
                    raw?: Json | null;
                    status: string;
                    synced_at?: string | null;
                    total_amount?: number | null;
                    updated_at?: string;
                    user_id: string;
                };
                Update: {
                    buyer_name?: string | null;
                    connection_id?: string | null;
                    created_at?: string;
                    currency?: string | null;
                    fulfilled_at?: string | null;
                    id?: string;
                    ordered_at?: string;
                    platform?: string;
                    platform_order_id?: string;
                    raw?: Json | null;
                    status?: string;
                    synced_at?: string | null;
                    total_amount?: number | null;
                    updated_at?: string;
                    user_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'orders_connection_id_fkey';
                        columns: ['connection_id'];
                        isOneToOne: false;
                        referencedRelation: 'sales_channel_connections';
                        referencedColumns: ['id'];
                    },
                ];
            };
            organization_invites: {
                Row: {
                    accepted_at: string | null;
                    accepted_by: string | null;
                    created_at: string;
                    expires_at: string;
                    id: string;
                    org_id: string;
                    revoked_at: string | null;
                    token: string;
                };
                Insert: {
                    accepted_at?: string | null;
                    accepted_by?: string | null;
                    created_at?: string;
                    expires_at: string;
                    id?: string;
                    org_id: string;
                    revoked_at?: string | null;
                    token: string;
                };
                Update: {
                    accepted_at?: string | null;
                    accepted_by?: string | null;
                    created_at?: string;
                    expires_at?: string;
                    id?: string;
                    org_id?: string;
                    revoked_at?: string | null;
                    token?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'organization_invites_org_id_fkey';
                        columns: ['org_id'];
                        isOneToOne: false;
                        referencedRelation: 'organizations';
                        referencedColumns: ['id'];
                    },
                ];
            };
            organization_members: {
                Row: {
                    created_at: string;
                    org_id: string;
                    role: string;
                    user_id: string;
                };
                Insert: {
                    created_at?: string;
                    org_id: string;
                    role?: string;
                    user_id: string;
                };
                Update: {
                    created_at?: string;
                    org_id?: string;
                    role?: string;
                    user_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'organization_members_org_id_fkey';
                        columns: ['org_id'];
                        isOneToOne: false;
                        referencedRelation: 'organizations';
                        referencedColumns: ['id'];
                    },
                ];
            };
            organizations: {
                Row: {
                    created_at: string;
                    id: string;
                    name: string;
                    owner_id: string;
                    seat_limit: number;
                };
                Insert: {
                    created_at?: string;
                    id?: string;
                    name: string;
                    owner_id: string;
                    seat_limit?: number;
                };
                Update: {
                    created_at?: string;
                    id?: string;
                    name?: string;
                    owner_id?: string;
                    seat_limit?: number;
                };
                Relationships: [];
            };
            polar_coupons: {
                Row: {
                    amount_cents: number | null;
                    basis_points: number | null;
                    batch_id: string | null;
                    code: string;
                    created_at: string;
                    currency: string | null;
                    disabled_at: string | null;
                    duration: string;
                    duration_in_months: number | null;
                    id: string;
                    issued_at: string | null;
                    max_redemptions: number;
                    name: string;
                    note: string | null;
                    polar_discount_id: string;
                    product_scope: string;
                    redeemed_at: string | null;
                    redemptions_count: number;
                    status: string;
                    type: string;
                    updated_at: string;
                };
                Insert: {
                    amount_cents?: number | null;
                    basis_points?: number | null;
                    batch_id?: string | null;
                    code: string;
                    created_at?: string;
                    currency?: string | null;
                    disabled_at?: string | null;
                    duration: string;
                    duration_in_months?: number | null;
                    id?: string;
                    issued_at?: string | null;
                    max_redemptions?: number;
                    name: string;
                    note?: string | null;
                    polar_discount_id: string;
                    product_scope?: string;
                    redeemed_at?: string | null;
                    redemptions_count?: number;
                    status?: string;
                    type: string;
                    updated_at?: string;
                };
                Update: {
                    amount_cents?: number | null;
                    basis_points?: number | null;
                    batch_id?: string | null;
                    code?: string;
                    created_at?: string;
                    currency?: string | null;
                    disabled_at?: string | null;
                    duration?: string;
                    duration_in_months?: number | null;
                    id?: string;
                    issued_at?: string | null;
                    max_redemptions?: number;
                    name?: string;
                    note?: string | null;
                    polar_discount_id?: string;
                    product_scope?: string;
                    redeemed_at?: string | null;
                    redemptions_count?: number;
                    status?: string;
                    type?: string;
                    updated_at?: string;
                };
                Relationships: [];
            };
            product_channel_skus: {
                Row: {
                    created_at: string;
                    external_key: string;
                    id: string;
                    platform: string;
                    product_id: string;
                    user_id: string;
                };
                Insert: {
                    created_at?: string;
                    external_key: string;
                    id?: string;
                    platform: string;
                    product_id: string;
                    user_id: string;
                };
                Update: {
                    created_at?: string;
                    external_key?: string;
                    id?: string;
                    platform?: string;
                    product_id?: string;
                    user_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'product_channel_skus_product_id_fkey';
                        columns: ['product_id'];
                        isOneToOne: false;
                        referencedRelation: 'products';
                        referencedColumns: ['id'];
                    },
                ];
            };
            product_stock_events: {
                Row: {
                    created_at: string;
                    created_by: string | null;
                    delta_units: number;
                    event_type: string;
                    id: string;
                    note: string | null;
                    product_id: string;
                    reference_id: string | null;
                    user_id: string;
                };
                Insert: {
                    created_at?: string;
                    created_by?: string | null;
                    delta_units: number;
                    event_type: string;
                    id?: string;
                    note?: string | null;
                    product_id: string;
                    reference_id?: string | null;
                    user_id: string;
                };
                Update: {
                    created_at?: string;
                    created_by?: string | null;
                    delta_units?: number;
                    event_type?: string;
                    id?: string;
                    note?: string | null;
                    product_id?: string;
                    reference_id?: string | null;
                    user_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'product_stock_events_product_id_fkey';
                        columns: ['product_id'];
                        isOneToOne: false;
                        referencedRelation: 'products';
                        referencedColumns: ['id'];
                    },
                ];
            };
            products: {
                Row: {
                    bean_id: string | null;
                    blend_id: string | null;
                    created_at: string;
                    id: string;
                    is_active: boolean;
                    name: string;
                    net_weight_grams: number;
                    roast_profile_id: string | null;
                    sku: string | null;
                    updated_at: string;
                    user_id: string;
                    yield_pct: number;
                };
                Insert: {
                    bean_id?: string | null;
                    blend_id?: string | null;
                    created_at?: string;
                    id?: string;
                    is_active?: boolean;
                    name: string;
                    net_weight_grams: number;
                    roast_profile_id?: string | null;
                    sku?: string | null;
                    updated_at?: string;
                    user_id: string;
                    yield_pct?: number;
                };
                Update: {
                    bean_id?: string | null;
                    blend_id?: string | null;
                    created_at?: string;
                    id?: string;
                    is_active?: boolean;
                    name?: string;
                    net_weight_grams?: number;
                    roast_profile_id?: string | null;
                    sku?: string | null;
                    updated_at?: string;
                    user_id?: string;
                    yield_pct?: number;
                };
                Relationships: [
                    {
                        foreignKeyName: 'products_bean_id_fkey';
                        columns: ['bean_id'];
                        isOneToOne: false;
                        referencedRelation: 'beans';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'products_blend_id_fkey';
                        columns: ['blend_id'];
                        isOneToOne: false;
                        referencedRelation: 'blends';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'products_roast_profile_id_fkey';
                        columns: ['roast_profile_id'];
                        isOneToOne: false;
                        referencedRelation: 'roast_profiles';
                        referencedColumns: ['id'];
                    },
                ];
            };
            profiles: {
                Row: {
                    avatar_url: string | null;
                    business_name: string | null;
                    business_registration_number: string | null;
                    country_code: string | null;
                    created_at: string;
                    default_roast_profile_id: string | null;
                    display_name: string | null;
                    id: string;
                    plan: string;
                    polar_customer_id: string | null;
                    updated_at: string;
                };
                Insert: {
                    avatar_url?: string | null;
                    business_name?: string | null;
                    business_registration_number?: string | null;
                    country_code?: string | null;
                    created_at?: string;
                    default_roast_profile_id?: string | null;
                    display_name?: string | null;
                    id: string;
                    plan?: string;
                    polar_customer_id?: string | null;
                    updated_at?: string;
                };
                Update: {
                    avatar_url?: string | null;
                    business_name?: string | null;
                    business_registration_number?: string | null;
                    country_code?: string | null;
                    created_at?: string;
                    default_roast_profile_id?: string | null;
                    display_name?: string | null;
                    id?: string;
                    plan?: string;
                    polar_customer_id?: string | null;
                    updated_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'profiles_default_roast_profile_id_fkey';
                        columns: ['default_roast_profile_id'];
                        isOneToOne: false;
                        referencedRelation: 'roast_profiles';
                        referencedColumns: ['id'];
                    },
                ];
            };
            recurrence_rules: {
                Row: {
                    batch_size_kg: number;
                    batch_type: string;
                    bean_id: string | null;
                    bean_name: string;
                    blend_id: string | null;
                    created_at: string;
                    dtstart: string;
                    green_lot: string;
                    id: string;
                    machine_id: string | null;
                    notes: string;
                    roast_profile_id: string | null;
                    rrule: string;
                    status: string;
                    target_roasted_kg: number;
                    until: string | null;
                    updated_at: string;
                    user_id: string;
                    yield_pct: number;
                };
                Insert: {
                    batch_size_kg?: number;
                    batch_type?: string;
                    bean_id?: string | null;
                    bean_name?: string;
                    blend_id?: string | null;
                    created_at?: string;
                    dtstart: string;
                    green_lot?: string;
                    id?: string;
                    machine_id?: string | null;
                    notes?: string;
                    roast_profile_id?: string | null;
                    rrule: string;
                    status?: string;
                    target_roasted_kg?: number;
                    until?: string | null;
                    updated_at?: string;
                    user_id: string;
                    yield_pct?: number;
                };
                Update: {
                    batch_size_kg?: number;
                    batch_type?: string;
                    bean_id?: string | null;
                    bean_name?: string;
                    blend_id?: string | null;
                    created_at?: string;
                    dtstart?: string;
                    green_lot?: string;
                    id?: string;
                    machine_id?: string | null;
                    notes?: string;
                    roast_profile_id?: string | null;
                    rrule?: string;
                    status?: string;
                    target_roasted_kg?: number;
                    until?: string | null;
                    updated_at?: string;
                    user_id?: string;
                    yield_pct?: number;
                };
                Relationships: [
                    {
                        foreignKeyName: 'recurrence_rules_bean_id_fkey';
                        columns: ['bean_id'];
                        isOneToOne: false;
                        referencedRelation: 'beans';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'recurrence_rules_blend_id_fkey';
                        columns: ['blend_id'];
                        isOneToOne: false;
                        referencedRelation: 'blends';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'recurrence_rules_roast_profile_id_fkey';
                        columns: ['roast_profile_id'];
                        isOneToOne: false;
                        referencedRelation: 'roast_profiles';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'recurrence_rules_user_id_fkey';
                        columns: ['user_id'];
                        isOneToOne: false;
                        referencedRelation: 'profiles';
                        referencedColumns: ['id'];
                    },
                ];
            };
            roast_day_plans: {
                Row: {
                    created_at: string;
                    date: string;
                    id: string;
                    notes: string;
                    updated_at: string;
                    user_id: string;
                };
                Insert: {
                    created_at?: string;
                    date: string;
                    id?: string;
                    notes?: string;
                    updated_at?: string;
                    user_id: string;
                };
                Update: {
                    created_at?: string;
                    date?: string;
                    id?: string;
                    notes?: string;
                    updated_at?: string;
                    user_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'roast_day_plans_user_id_fkey';
                        columns: ['user_id'];
                        isOneToOne: false;
                        referencedRelation: 'profiles';
                        referencedColumns: ['id'];
                    },
                ];
            };
            roast_plan_batches: {
                Row: {
                    batch_count: number;
                    batch_size_kg: number;
                    batch_type: string;
                    bean_id: string | null;
                    bean_name: string;
                    blend_id: string | null;
                    created_at: string;
                    exception_type: string | null;
                    green_lot: string;
                    id: string;
                    machine_id: string | null;
                    notes: string;
                    order_index: number;
                    original_date: string | null;
                    plan_id: string;
                    recurrence_group_id: string | null;
                    recurrence_rule_id: string | null;
                    roast_profile_id: string | null;
                    rrule: string | null;
                    scheduled_date: string | null;
                    status: string;
                    target_roasted_kg: number;
                    updated_at: string;
                    yield_pct: number;
                };
                Insert: {
                    batch_count?: number;
                    batch_size_kg: number;
                    batch_type?: string;
                    bean_id?: string | null;
                    bean_name: string;
                    blend_id?: string | null;
                    created_at?: string;
                    exception_type?: string | null;
                    green_lot?: string;
                    id?: string;
                    machine_id?: string | null;
                    notes?: string;
                    order_index?: number;
                    original_date?: string | null;
                    plan_id: string;
                    recurrence_group_id?: string | null;
                    recurrence_rule_id?: string | null;
                    roast_profile_id?: string | null;
                    rrule?: string | null;
                    scheduled_date?: string | null;
                    status?: string;
                    target_roasted_kg: number;
                    updated_at?: string;
                    yield_pct?: number;
                };
                Update: {
                    batch_count?: number;
                    batch_size_kg?: number;
                    batch_type?: string;
                    bean_id?: string | null;
                    bean_name?: string;
                    blend_id?: string | null;
                    created_at?: string;
                    exception_type?: string | null;
                    green_lot?: string;
                    id?: string;
                    machine_id?: string | null;
                    notes?: string;
                    order_index?: number;
                    original_date?: string | null;
                    plan_id?: string;
                    recurrence_group_id?: string | null;
                    recurrence_rule_id?: string | null;
                    roast_profile_id?: string | null;
                    rrule?: string | null;
                    scheduled_date?: string | null;
                    status?: string;
                    target_roasted_kg?: number;
                    updated_at?: string;
                    yield_pct?: number;
                };
                Relationships: [
                    {
                        foreignKeyName: 'roast_plan_batches_bean_id_fkey';
                        columns: ['bean_id'];
                        isOneToOne: false;
                        referencedRelation: 'beans';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'roast_plan_batches_blend_id_fkey';
                        columns: ['blend_id'];
                        isOneToOne: false;
                        referencedRelation: 'blends';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'roast_plan_batches_plan_id_fkey';
                        columns: ['plan_id'];
                        isOneToOne: false;
                        referencedRelation: 'roast_day_plans';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'roast_plan_batches_recurrence_rule_id_fkey';
                        columns: ['recurrence_rule_id'];
                        isOneToOne: false;
                        referencedRelation: 'recurrence_rules';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'roast_plan_batches_roast_profile_id_fkey';
                        columns: ['roast_profile_id'];
                        isOneToOne: false;
                        referencedRelation: 'roast_profiles';
                        referencedColumns: ['id'];
                    },
                ];
            };
            roast_profiles: {
                Row: {
                    charge_temp_celsius: number | null;
                    created_at: string;
                    default_bean_id: string | null;
                    default_blend_id: string | null;
                    description: string | null;
                    dev_pct: number | null;
                    dev_time_sec: number | null;
                    drop_temp_celsius: number | null;
                    duration_sec: number | null;
                    heater_events: Json | null;
                    id: string;
                    machine_brand: string | null;
                    machine_id: string | null;
                    machine_name: string | null;
                    machine_protocol: string | null;
                    machine_roaster_key: string | null;
                    name: string;
                    source_session_id: string;
                    target_level: string;
                    updated_at: string;
                    user_id: string;
                };
                Insert: {
                    charge_temp_celsius?: number | null;
                    created_at?: string;
                    default_bean_id?: string | null;
                    default_blend_id?: string | null;
                    description?: string | null;
                    dev_pct?: number | null;
                    dev_time_sec?: number | null;
                    drop_temp_celsius?: number | null;
                    duration_sec?: number | null;
                    heater_events?: Json | null;
                    id?: string;
                    machine_brand?: string | null;
                    machine_id?: string | null;
                    machine_name?: string | null;
                    machine_protocol?: string | null;
                    machine_roaster_key?: string | null;
                    name: string;
                    source_session_id: string;
                    target_level: string;
                    updated_at?: string;
                    user_id: string;
                };
                Update: {
                    charge_temp_celsius?: number | null;
                    created_at?: string;
                    default_bean_id?: string | null;
                    default_blend_id?: string | null;
                    description?: string | null;
                    dev_pct?: number | null;
                    dev_time_sec?: number | null;
                    drop_temp_celsius?: number | null;
                    duration_sec?: number | null;
                    heater_events?: Json | null;
                    id?: string;
                    machine_brand?: string | null;
                    machine_id?: string | null;
                    machine_name?: string | null;
                    machine_protocol?: string | null;
                    machine_roaster_key?: string | null;
                    name?: string;
                    source_session_id?: string;
                    target_level?: string;
                    updated_at?: string;
                    user_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'roast_profiles_default_bean_id_fkey';
                        columns: ['default_bean_id'];
                        isOneToOne: false;
                        referencedRelation: 'beans';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'roast_profiles_default_blend_id_fkey';
                        columns: ['default_blend_id'];
                        isOneToOne: false;
                        referencedRelation: 'blends';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'roast_profiles_source_session_id_fkey';
                        columns: ['source_session_id'];
                        isOneToOne: false;
                        referencedRelation: 'roast_sessions';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'roast_profiles_user_id_fkey';
                        columns: ['user_id'];
                        isOneToOne: false;
                        referencedRelation: 'profiles';
                        referencedColumns: ['id'];
                    },
                ];
            };
            roast_sessions: {
                Row: {
                    ambient_humidity_pct: number | null;
                    ambient_temp_celsius: number | null;
                    bbp_seconds: number | null;
                    bbp_tsv_path: string | null;
                    bean_id: string | null;
                    /** Free-text name when bean_id is null (sample / no-inventory). */
                    bean_label: string | null;
                    charge_temp_celsius: number | null;
                    /** Whole-bean roast color. Manual entry, no meter. Omitted until recorded. */
                    color_whole?: string | null;
                    /** Ground roast color. Manual entry, no meter. Omitted until recorded. */
                    color_ground?: string | null;
                    created_at: string;
                    created_by: string | null;
                    /** Bulk density, g/L. History QC entry. Omitted until recorded. */
                    density_g_per_l?: number | null;
                    drop_temp_celsius: number | null;
                    duration_seconds: number | null;
                    events: Json;
                    heater_events: Json | null;
                    id: string;
                    machine_brand: string | null;
                    machine_id: string | null;
                    machine_name: string | null;
                    machine_protocol: string | null;
                    machine_roaster_key: string | null;
                    /** Moisture, percent. History QC entry. Omitted until recorded. */
                    moisture_pct?: number | null;
                    notes: string | null;
                    output_weight_grams: number | null;
                    plan_batch_id: string | null;
                    profile_id: string | null;
                    roast_level: string | null;
                    roasted_at: string | null;
                    scheduled_at: string | null;
                    status: string;
                    tsv_path: string | null;
                    updated_at: string;
                    user_id: string;
                    weight_grams: number;
                };
                Insert: {
                    ambient_humidity_pct?: number | null;
                    ambient_temp_celsius?: number | null;
                    bbp_seconds?: number | null;
                    bbp_tsv_path?: string | null;
                    bean_id?: string | null;
                    bean_label?: string | null;
                    charge_temp_celsius?: number | null;
                    color_whole?: string | null;
                    color_ground?: string | null;
                    created_at?: string;
                    created_by?: string | null;
                    density_g_per_l?: number | null;
                    drop_temp_celsius?: number | null;
                    duration_seconds?: number | null;
                    events?: Json;
                    heater_events?: Json | null;
                    id?: string;
                    machine_brand?: string | null;
                    machine_id?: string | null;
                    machine_name?: string | null;
                    machine_protocol?: string | null;
                    machine_roaster_key?: string | null;
                    moisture_pct?: number | null;
                    notes?: string | null;
                    output_weight_grams?: number | null;
                    plan_batch_id?: string | null;
                    profile_id?: string | null;
                    roast_level?: string | null;
                    roasted_at?: string | null;
                    scheduled_at?: string | null;
                    status?: string;
                    tsv_path?: string | null;
                    updated_at?: string;
                    user_id: string;
                    weight_grams: number;
                };
                Update: {
                    ambient_humidity_pct?: number | null;
                    ambient_temp_celsius?: number | null;
                    bbp_seconds?: number | null;
                    bbp_tsv_path?: string | null;
                    bean_id?: string | null;
                    bean_label?: string | null;
                    charge_temp_celsius?: number | null;
                    color_whole?: string | null;
                    color_ground?: string | null;
                    created_at?: string;
                    created_by?: string | null;
                    density_g_per_l?: number | null;
                    drop_temp_celsius?: number | null;
                    duration_seconds?: number | null;
                    events?: Json;
                    heater_events?: Json | null;
                    id?: string;
                    machine_brand?: string | null;
                    machine_id?: string | null;
                    machine_name?: string | null;
                    machine_protocol?: string | null;
                    machine_roaster_key?: string | null;
                    moisture_pct?: number | null;
                    notes?: string | null;
                    output_weight_grams?: number | null;
                    plan_batch_id?: string | null;
                    profile_id?: string | null;
                    roast_level?: string | null;
                    roasted_at?: string | null;
                    scheduled_at?: string | null;
                    status?: string;
                    tsv_path?: string | null;
                    updated_at?: string;
                    user_id?: string;
                    weight_grams?: number;
                };
                Relationships: [
                    {
                        foreignKeyName: 'roast_sessions_bean_id_fkey';
                        columns: ['bean_id'];
                        isOneToOne: false;
                        referencedRelation: 'beans';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'roast_sessions_plan_batch_id_fkey';
                        columns: ['plan_batch_id'];
                        isOneToOne: false;
                        referencedRelation: 'roast_plan_batches';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'roast_sessions_profile_id_fkey';
                        columns: ['profile_id'];
                        isOneToOne: false;
                        referencedRelation: 'roast_profiles';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'roast_sessions_user_id_fkey';
                        columns: ['user_id'];
                        isOneToOne: false;
                        referencedRelation: 'profiles';
                        referencedColumns: ['id'];
                    },
                ];
            };
            roasted_stock_events: {
                Row: {
                    bean_id: string | null;
                    blend_id: string | null;
                    created_at: string;
                    created_by: string | null;
                    delta_grams: number;
                    event_type: string;
                    id: string;
                    is_estimate: boolean;
                    note: string | null;
                    reference_id: string | null;
                    user_id: string;
                };
                Insert: {
                    bean_id?: string | null;
                    blend_id?: string | null;
                    created_at?: string;
                    created_by?: string | null;
                    delta_grams: number;
                    event_type: string;
                    id?: string;
                    is_estimate?: boolean;
                    note?: string | null;
                    reference_id?: string | null;
                    user_id: string;
                };
                Update: {
                    bean_id?: string | null;
                    blend_id?: string | null;
                    created_at?: string;
                    created_by?: string | null;
                    delta_grams?: number;
                    event_type?: string;
                    id?: string;
                    is_estimate?: boolean;
                    note?: string | null;
                    reference_id?: string | null;
                    user_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'roasted_stock_events_bean_id_fkey';
                        columns: ['bean_id'];
                        isOneToOne: false;
                        referencedRelation: 'beans';
                        referencedColumns: ['id'];
                    },
                    {
                        foreignKeyName: 'roasted_stock_events_blend_id_fkey';
                        columns: ['blend_id'];
                        isOneToOne: false;
                        referencedRelation: 'blends';
                        referencedColumns: ['id'];
                    },
                ];
            };
            sales_channel_connections: {
                Row: {
                    auto_fulfill_on_shipped: boolean;
                    consecutive_failures: number;
                    created_at: string;
                    display_name: string | null;
                    id: string;
                    last_error: string | null;
                    last_polled_at: string | null;
                    platform: string;
                    poll_cursor: Json | null;
                    shop_identifier: string;
                    status: string;
                    updated_at: string;
                    user_id: string;
                    webhook_registered: boolean;
                };
                Insert: {
                    auto_fulfill_on_shipped?: boolean;
                    consecutive_failures?: number;
                    created_at?: string;
                    display_name?: string | null;
                    id?: string;
                    last_error?: string | null;
                    last_polled_at?: string | null;
                    platform: string;
                    poll_cursor?: Json | null;
                    shop_identifier: string;
                    status?: string;
                    updated_at?: string;
                    user_id: string;
                    webhook_registered?: boolean;
                };
                Update: {
                    auto_fulfill_on_shipped?: boolean;
                    consecutive_failures?: number;
                    created_at?: string;
                    display_name?: string | null;
                    id?: string;
                    last_error?: string | null;
                    last_polled_at?: string | null;
                    platform?: string;
                    poll_cursor?: Json | null;
                    shop_identifier?: string;
                    status?: string;
                    updated_at?: string;
                    user_id?: string;
                    webhook_registered?: boolean;
                };
                Relationships: [];
            };
            sales_channel_secrets: {
                Row: {
                    connection_id: string;
                    credentials: Json;
                    updated_at: string;
                };
                Insert: {
                    connection_id: string;
                    credentials: Json;
                    updated_at?: string;
                };
                Update: {
                    connection_id?: string;
                    credentials?: Json;
                    updated_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'sales_channel_secrets_connection_id_fkey';
                        columns: ['connection_id'];
                        isOneToOne: true;
                        referencedRelation: 'sales_channel_connections';
                        referencedColumns: ['id'];
                    },
                ];
            };
            subscriptions: {
                Row: {
                    amount: number | null;
                    cancel_at_period_end: boolean | null;
                    canceled_at: string | null;
                    created_at: string;
                    currency: string | null;
                    current_period_end: string | null;
                    current_period_start: string | null;
                    ends_at: string | null;
                    id: string;
                    polar_checkout_id: string | null;
                    polar_product_id: string | null;
                    polar_subscription_id: string | null;
                    recurring_interval: string | null;
                    started_at: string | null;
                    status: string;
                    trial_end: string | null;
                    updated_at: string;
                    user_id: string;
                };
                Insert: {
                    amount?: number | null;
                    cancel_at_period_end?: boolean | null;
                    canceled_at?: string | null;
                    created_at?: string;
                    currency?: string | null;
                    current_period_end?: string | null;
                    current_period_start?: string | null;
                    ends_at?: string | null;
                    id?: string;
                    polar_checkout_id?: string | null;
                    polar_product_id?: string | null;
                    polar_subscription_id?: string | null;
                    recurring_interval?: string | null;
                    started_at?: string | null;
                    status?: string;
                    trial_end?: string | null;
                    updated_at?: string;
                    user_id: string;
                };
                Update: {
                    amount?: number | null;
                    cancel_at_period_end?: boolean | null;
                    canceled_at?: string | null;
                    created_at?: string;
                    currency?: string | null;
                    current_period_end?: string | null;
                    current_period_start?: string | null;
                    ends_at?: string | null;
                    id?: string;
                    polar_checkout_id?: string | null;
                    polar_product_id?: string | null;
                    polar_subscription_id?: string | null;
                    recurring_interval?: string | null;
                    started_at?: string | null;
                    status?: string;
                    trial_end?: string | null;
                    updated_at?: string;
                    user_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'subscriptions_user_id_fkey';
                        columns: ['user_id'];
                        isOneToOne: false;
                        referencedRelation: 'profiles';
                        referencedColumns: ['id'];
                    },
                ];
            };
        };
        Views: {
            active_subscriptions: {
                Row: {
                    amount: number | null;
                    cancel_at_period_end: boolean | null;
                    canceled_at: string | null;
                    created_at: string | null;
                    currency: string | null;
                    current_period_end: string | null;
                    current_period_start: string | null;
                    ends_at: string | null;
                    id: string | null;
                    polar_checkout_id: string | null;
                    polar_product_id: string | null;
                    polar_subscription_id: string | null;
                    recurring_interval: string | null;
                    started_at: string | null;
                    status: string | null;
                    trial_end: string | null;
                    updated_at: string | null;
                    user_id: string | null;
                };
                Insert: {
                    amount?: number | null;
                    cancel_at_period_end?: boolean | null;
                    canceled_at?: string | null;
                    created_at?: string | null;
                    currency?: string | null;
                    current_period_end?: string | null;
                    current_period_start?: string | null;
                    ends_at?: string | null;
                    id?: string | null;
                    polar_checkout_id?: string | null;
                    polar_product_id?: string | null;
                    polar_subscription_id?: string | null;
                    recurring_interval?: string | null;
                    started_at?: string | null;
                    status?: string | null;
                    trial_end?: string | null;
                    updated_at?: string | null;
                    user_id?: string | null;
                };
                Update: {
                    amount?: number | null;
                    cancel_at_period_end?: boolean | null;
                    canceled_at?: string | null;
                    created_at?: string | null;
                    currency?: string | null;
                    current_period_end?: string | null;
                    current_period_start?: string | null;
                    ends_at?: string | null;
                    id?: string | null;
                    polar_checkout_id?: string | null;
                    polar_product_id?: string | null;
                    polar_subscription_id?: string | null;
                    recurring_interval?: string | null;
                    started_at?: string | null;
                    status?: string | null;
                    trial_end?: string | null;
                    updated_at?: string | null;
                    user_id?: string | null;
                };
                Relationships: [
                    {
                        foreignKeyName: 'subscriptions_user_id_fkey';
                        columns: ['user_id'];
                        isOneToOne: false;
                        referencedRelation: 'profiles';
                        referencedColumns: ['id'];
                    },
                ];
            };
        };
        Functions: {
            admin_auth_session_ips: {
                Args: never;
                Returns: {
                    ip: string;
                    last_seen: string;
                    session_count: number;
                    user_count: number;
                }[];
            };
            admin_auth_user_activity: {
                Args: never;
                Returns: {
                    last_ip: string;
                    last_seen: string;
                    session_count: number;
                    user_id: string;
                }[];
            };
            admin_user_roster: {
                Args: never;
                Returns: {
                    business_name: string;
                    created_at: string;
                    display_name: string;
                    email: string;
                    id: string;
                    last_sign_in_at: string;
                    plan: string;
                    polar_customer_id: string;
                    provider: string;
                    roast_count: number;
                }[];
            };
            calc_plan_batch_count: {
                Args: {
                    p_batch_count?: number;
                    p_batch_size_kg: number;
                    p_target_roasted_kg: number;
                    p_yield_pct: number;
                };
                Returns: number;
            };
            cancel_order: { Args: { p_order_id: string }; Returns: undefined };
            channel_try_integer: { Args: { p_value: string }; Returns: number };
            channel_try_timestamptz: { Args: { p_value: string }; Returns: string };
            compute_inventory_alerts: {
                Args: { p_horizon_days?: number; p_user_id: string };
                Returns: undefined;
            };
            compute_inventory_alerts_for_all_users: {
                Args: { p_horizon_days?: number };
                Returns: string;
            };
            create_order: { Args: { p_lines: Json; p_order: Json }; Returns: string };
            create_org_invite: {
                Args: { p_expires_in?: string; p_token: string };
                Returns: string;
            };
            delete_roast_session: {
                Args: { p_session_id: string };
                Returns: undefined;
            };
            expand_rrule_in_range: {
                Args: {
                    p_dtstart: string;
                    p_range_end: string;
                    p_range_start: string;
                    p_rrule: string;
                    p_until?: string;
                };
                Returns: string[];
            };
            fulfill_order: { Args: { p_order_id: string }; Returns: undefined };
            get_bean_available_stock: { Args: { p_bean_id: string }; Returns: number };
            get_bean_current_stock: { Args: { p_bean_id: string }; Returns: number };
            get_bean_effective_stock: {
                Args: { p_bean_id: string; p_horizon_days?: number };
                Returns: number;
            };
            get_bean_reserved_stock: {
                Args: { p_bean_id: string; p_horizon_days?: number };
                Returns: number;
            };
            get_bean_stock_summary: {
                Args: { p_bean_id: string; p_horizon_days?: number };
                Returns: Json;
            };
            get_product_current_stock: {
                Args: { p_product_id: string };
                Returns: number;
            };
            get_roasting_requirements: { Args: { p_user_id: string }; Returns: Json };
            get_stock_summary_rows: {
                Args: { p_bean_id?: string; p_horizon_days?: number; p_user_id: string };
                Returns: {
                    available_grams: number;
                    bean_id: string;
                    current_grams: number;
                    effective_grams: number;
                    reserved_grams: number;
                }[];
            };
            get_user_product_stock: { Args: { p_user_id: string }; Returns: Json };
            get_user_roasted_stock: { Args: { p_user_id: string }; Returns: Json };
            get_user_stock_summaries: {
                Args: { p_horizon_days?: number; p_user_id: string };
                Returns: Json;
            };
            has_workspace_access: { Args: { target_owner: string }; Returns: boolean };
            insert_packaging_op: {
                Args: { p_product_events: Json; p_roasted_events: Json };
                Returns: undefined;
            };
            insert_product_stock_events_batch: {
                Args: { p_events: Json };
                Returns: Json;
            };
            insert_roasted_stock_events_batch: {
                Args: { p_events: Json };
                Returns: undefined;
            };
            insert_stock_events_batch: {
                Args: { p_events: Json; p_roasted_events?: Json };
                Returns: undefined;
            };
            is_org_member_or_owner: { Args: { p_org_id: string }; Returns: boolean };
            is_org_owner: { Args: { p_org_id: string }; Returns: boolean };
            list_org_members: {
                Args: { p_org_id: string };
                Returns: {
                    business_name: string;
                    created_at: string;
                    display_name: string;
                    email: string;
                    role: string;
                    user_id: string;
                }[];
            };
            profile_write_error: { Args: { p_user_id: string }; Returns: string };
            redeem_org_invite: { Args: { p_token: string }; Returns: string };
            remove_org_member: {
                Args: { p_member_id: string; p_org_id: string };
                Returns: undefined;
            };
            reorder_cupping_samples: {
                Args: { p_event_id: string; p_ordered_ids: string[] };
                Returns: undefined;
            };
            reorder_plan_batches: {
                Args: { p_ordered_ids: string[]; p_plan_id: string };
                Returns: undefined;
            };
            replace_blend_components: {
                Args: { p_blend_id: string; p_components: Json };
                Returns: undefined;
            };
            revoke_org_invite: { Args: { p_invite_id: string }; Returns: undefined };
            roast_deduction_blocked: {
                Args: { p_reference_id: string };
                Returns: boolean;
            };
            run_daily_inventory_maintenance: { Args: never; Returns: undefined };
            save_roast_op: {
                Args: {
                    p_deduct: boolean;
                    p_deduction_grams: number;
                    p_inbound_grams: number;
                    p_inbound_is_estimate: boolean;
                    p_session: Json;
                };
                Returns: {
                    ambient_humidity_pct: number | null;
                    ambient_temp_celsius: number | null;
                    bbp_seconds: number | null;
                    bbp_tsv_path: string | null;
                    bean_id: string | null;
                    charge_temp_celsius: number | null;
                    /** Whole-bean roast color. Manual entry, no meter. Omitted until recorded. */
                    color_whole?: string | null;
                    /** Ground roast color. Manual entry, no meter. Omitted until recorded. */
                    color_ground?: string | null;
                    created_at: string;
                    created_by: string | null;
                    density_g_per_l?: number | null;
                    drop_temp_celsius: number | null;
                    duration_seconds: number | null;
                    events: Json;
                    heater_events: Json | null;
                    id: string;
                    machine_brand: string | null;
                    machine_id: string | null;
                    machine_name: string | null;
                    machine_protocol: string | null;
                    machine_roaster_key: string | null;
                    moisture_pct?: number | null;
                    notes: string | null;
                    output_weight_grams: number | null;
                    plan_batch_id: string | null;
                    profile_id: string | null;
                    roast_level: string | null;
                    roasted_at: string | null;
                    scheduled_at: string | null;
                    status: string;
                    tsv_path: string | null;
                    updated_at: string;
                    user_id: string;
                    weight_grams: number;
                };
                SetofOptions: {
                    from: '*';
                    to: 'roast_sessions';
                    isOneToOne: true;
                    isSetofReturn: false;
                };
            };
            set_session_charge_weight: {
                Args: {
                    p_inbound_grams: number;
                    p_inbound_is_estimate: boolean;
                    p_session_id: string;
                    p_weight_grams: number;
                };
                Returns: undefined;
            };
            set_session_output_weight: {
                Args: {
                    p_inbound_grams: number;
                    p_inbound_is_estimate: boolean;
                    p_output_grams: number;
                    p_session_id: string;
                };
                Returns: undefined;
            };
            sync_channel_orders_batch: {
                Args: { p_connection_id: string; p_orders: Json; p_user_id: string };
                Returns: Json;
            };
            update_roast_session_record: {
                Args: {
                    p_drop_temp_celsius: number;
                    p_duration_seconds: number;
                    p_events: Json;
                    p_expected_events: Json;
                    p_expected_heater_events: Json;
                    p_heater_events: Json;
                    p_profile_summary: Json;
                    p_session_id: string;
                };
                Returns: Database['public']['Tables']['roast_sessions']['Row'];
                SetofOptions: {
                    from: '*';
                    to: 'roast_sessions';
                    isOneToOne: true;
                    isSetofReturn: false;
                };
            };
            upsert_roasted_inbound: {
                Args: {
                    p_grams: number;
                    p_is_estimate: boolean;
                    p_session_id: string;
                    p_user_id: string;
                };
                Returns: undefined;
            };
            write_cupping_scorecards_batch: {
                Args: {
                    p_cards: Json;
                    p_cupped_by: string;
                    p_invite_id: string;
                    p_participant_id: string;
                    p_publish: boolean;
                };
                Returns: {
                    created: boolean;
                    cupped_at: string;
                    id: string;
                    sample_id: string;
                    total_score: number;
                }[];
            };
        };
        Enums: {
            [_ in never]: never;
        };
        CompositeTypes: {
            [_ in never]: never;
        };
    };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
    DefaultSchemaTableNameOrOptions extends
        | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
        | { schema: keyof DatabaseWithoutInternals },
    TableName extends DefaultSchemaTableNameOrOptions extends {
        schema: keyof DatabaseWithoutInternals;
    }
        ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
              DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
        : never = never,
> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
}
    ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
          DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
          Row: infer R;
      }
        ? R
        : never
    : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
      ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
            Row: infer R;
        }
          ? R
          : never
      : never;

export type TablesInsert<
    DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
    TableName extends DefaultSchemaTableNameOrOptions extends {
        schema: keyof DatabaseWithoutInternals;
    }
        ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
        : never = never,
> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
}
    ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
          Insert: infer I;
      }
        ? I
        : never
    : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
      ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
            Insert: infer I;
        }
          ? I
          : never
      : never;

export type TablesUpdate<
    DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
    TableName extends DefaultSchemaTableNameOrOptions extends {
        schema: keyof DatabaseWithoutInternals;
    }
        ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
        : never = never,
> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
}
    ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
          Update: infer U;
      }
        ? U
        : never
    : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
      ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
            Update: infer U;
        }
          ? U
          : never
      : never;

export type Enums<
    DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
    EnumName extends DefaultSchemaEnumNameOrOptions extends {
        schema: keyof DatabaseWithoutInternals;
    }
        ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
        : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
}
    ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
    : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
      ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
      : never;

export type CompositeTypes<
    PublicCompositeTypeNameOrOptions extends
        | keyof DefaultSchema['CompositeTypes']
        | { schema: keyof DatabaseWithoutInternals },
    CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
        schema: keyof DatabaseWithoutInternals;
    }
        ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
        : never = never,
> = PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
}
    ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
    : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
      ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
      : never;

export const Constants = {
    graphql_public: {
        Enums: {},
    },
    public: {
        Enums: {},
    },
} as const;

// ── Convenience aliases ──────────────────────────────────────────────────────

export type Bean = Database['public']['Tables']['beans']['Row'];
export type BeanInsert = Database['public']['Tables']['beans']['Insert'];
export type BeanUpdate = Database['public']['Tables']['beans']['Update'];

export type Profile = Database['public']['Tables']['profiles']['Row'];

export type RoastProfile = Database['public']['Tables']['roast_profiles']['Row'];

export type RoastSession = Database['public']['Tables']['roast_sessions']['Row'];
export type RoastSessionWithRelations = RoastSession & {
    beans: Pick<Bean, 'name' | 'origin' | 'region' | 'variety' | 'process' | 'farm'> | null;
    roast_profiles: Pick<RoastProfile, 'name' | 'target_level'> | null;
};

export type Cupping = Database['public']['Tables']['cuppings']['Row'];
export type CuppingInvite = Database['public']['Tables']['cupping_invites']['Row'];
export type CuppingEvent = Database['public']['Tables']['cupping_events']['Row'];
export type CuppingFormTemplate = Database['public']['Tables']['cupping_form_templates']['Row'];
export type CuppingParticipant = Database['public']['Tables']['cupping_participants']['Row'];
export type CuppingSample = Database['public']['Tables']['cupping_samples']['Row'];

export type DayPlan = Database['public']['Tables']['roast_day_plans']['Row'];

export type PlanBatch = Database['public']['Tables']['roast_plan_batches']['Row'];
export type PlanBatchInsert = Database['public']['Tables']['roast_plan_batches']['Insert'];
export type PlanBatchUpdate = Database['public']['Tables']['roast_plan_batches']['Update'] & { id: string };
export type PlanBatchWithProgress = PlanBatch & { completed_sessions: number };

export type PlanBatchHandoff = {
    planBatchId: string;
    planId: string;
    beanId: string | null;
    blendId: string | null;
    beanName: string;
    batchSizeKg: number;
    profileId: string | null;
    batchCount: number;
    completedSessions: number;
};

export type RecurrenceRule = Database['public']['Tables']['recurrence_rules']['Row'];
export type RecurrenceRuleInsert = Database['public']['Tables']['recurrence_rules']['Insert'];
export type RecurrenceRuleUpdate = Database['public']['Tables']['recurrence_rules']['Update'];

export type MachineConnectionLog = Database['public']['Tables']['machine_connection_logs']['Row'];
export type MachineConnectionLogInsert = Database['public']['Tables']['machine_connection_logs']['Insert'];
