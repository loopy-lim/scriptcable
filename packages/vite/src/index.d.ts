export type ScriptcaViteOptions = {
    /** Path to scriptca.json (default: project root) */
    configPath?: string;
    /** Virtual module id for the generated client */
    virtualId?: string;
};
type VitePlugin = {
    name: string;
    configResolved?: (config: {
        root: string;
    }) => void;
    buildStart?: () => Promise<void>;
    resolveId?: (id: string) => string | null;
    load?: (id: string) => Promise<string | null> | string | null;
    handleHotUpdate?: (ctx: {
        file: string;
        server: {
            ws: {
                send: (msg: unknown) => void;
            };
            restart: () => Promise<void>;
        };
    }) => Promise<void> | void;
};
export declare function scriptca(options?: ScriptcaViteOptions): VitePlugin;
export default scriptca;
//# sourceMappingURL=index.d.ts.map