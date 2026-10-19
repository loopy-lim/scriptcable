import type { ScriptcaConfig, ScriptcaProfile } from '@scriptca/types';
/** Build a scriptc library profile from scriptca.json. */
export declare function configToProfile(config: ScriptcaConfig): ScriptcaProfile;
export declare function normalizePrefix(prefix: string): string;
export declare function loadConfig(raw: unknown): ScriptcaConfig;
//# sourceMappingURL=profile.d.ts.map