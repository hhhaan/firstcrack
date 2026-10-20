import type { Database, Json } from '../../src/shared/types/database.types';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type BillingTables =
    | 'billing_customers'
    | 'polar_subscription_state'
    | 'polar_webhook_events'
    | 'polar_notification_outbox';
type BillingRPCs = 'apply_polar_subscription_event' | 'claim_polar_notification' | 'finish_polar_notification';
export type PublicBillingTables = Assert<
    Equal<Extract<keyof Database['public']['Tables'], BillingTables>, BillingTables>
>;
export type PublicBillingRPCs = Assert<Equal<Extract<keyof Database['public']['Functions'], BillingRPCs>, BillingRPCs>>;
export type NoGraphQLBillingTables = Assert<
    Equal<Extract<keyof Database['graphql_public']['Tables'], BillingTables>, never>
>;
export type NoGraphQLBillingRPCs = Assert<
    Equal<Extract<keyof Database['graphql_public']['Functions'], BillingRPCs>, never>
>;
export type CustomerOwner = Assert<Equal<Database['public']['Tables']['billing_customers']['Row']['user_id'], string>>;
export type CustomerFK = Assert<
    Equal<Database['public']['Tables']['billing_customers']['Relationships'][0]['referencedRelation'], 'profiles'>
>;
export type SubscriptionFK = Assert<
    Equal<
        Database['public']['Tables']['polar_subscription_state']['Relationships'][0]['foreignKeyName'],
        'polar_subscription_state_user_id_fkey'
    >
>;
export type ClaimArgs = Assert<
    Equal<
        Database['public']['Functions']['claim_polar_notification']['Args'],
        { p_org_id: string; p_event_id: string; p_payload: Json }
    >
>;
export type FinishResult = Assert<
    Equal<Database['public']['Functions']['finish_polar_notification']['Returns'], boolean>
>;
