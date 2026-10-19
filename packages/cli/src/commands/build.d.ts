import { type CodegenTarget } from '@scriptca/core/codegen';
export type BuildCliOptions = {
    cwd?: string;
    target?: 'wasm' | 'native' | 'both';
    hosts?: CodegenTarget[];
    configPath?: string;
};
export declare function runBuild(opts?: BuildCliOptions): Promise<number>;
//# sourceMappingURL=build.d.ts.map