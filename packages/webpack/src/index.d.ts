export type ScriptcaWebpackOptions = {
    configPath?: string;
};
export declare class ScriptcaWebpackPlugin {
    private options;
    constructor(options?: ScriptcaWebpackOptions);
    apply(compiler: {
        context?: string;
        hooks: {
            beforeCompile: {
                tapPromise: (name: string, fn: () => Promise<void>) => void;
            };
        };
    }): void;
}
/** Alias for Rspack / Rsbuild (same compiler hooks). */
export declare const ScriptcaRspackPlugin: typeof ScriptcaWebpackPlugin;
export default ScriptcaWebpackPlugin;
//# sourceMappingURL=index.d.ts.map