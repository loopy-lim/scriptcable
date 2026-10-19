export type WithScriptcaOptions = {
    configPath?: string;
};
/** Prebuild helper — works with Turbopack (`next dev --turbo`) via npm script. */
export declare function scriptcaBuild(options?: WithScriptcaOptions & {
    cwd?: string;
}): Promise<string>;
type NextConfig = Record<string, unknown> & {
    webpack?: (config: any, ctx: any) => any;
};
export declare function withScriptca(nextConfig?: NextConfig, options?: WithScriptcaOptions): NextConfig;
export default withScriptca;
//# sourceMappingURL=index.d.ts.map