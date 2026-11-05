/** Factory-scale roasters. Enterprise, tester and event trials share access.
 *  Giesen W45A/W60A and W140A. Bühler RM60/RM120/RM240 share one registry key.
 *  IMF, Petroncini TT, and Neuhaus Neotec are plant lines.
 *  Loring and Probat G/UG stay open: those keys also cover smaller machines.
 */
const ENTERPRISE_ONLY_ROASTER_KEYS = new Set([
    'giesen_w45a_w60a',
    'giesen_w140a_v1',
    'giesen_w140a_v2',
    'buhler_rm60_240',
    'imf_rm',
    'imf_rm_auto',
    'imf_rm_control',
    'imf_rm_legacy',
    'petroncini_asem',
    'petroncini_maestro',
    'petroncini_maestro_i06',
    'petroncini_traditional',
    'neuhaus_neoroast',
    'neuhaus_rfb',
]);
const ENTERPRISE_ACCOUNT_PLANS = new Set(['enterprise', 'tester', 'trial-event']);

export const roasterRequiresEnterprise = (roasterKey: string): boolean => ENTERPRISE_ONLY_ROASTER_KEYS.has(roasterKey);

export const canConnectRoaster = (roasterKey: string, plan: string | null | undefined): boolean =>
    !roasterRequiresEnterprise(roasterKey) || ENTERPRISE_ACCOUNT_PLANS.has(plan ?? '');
