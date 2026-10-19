/** @scriptca/types — shared EngineClient contract and errors. */
export class ScriptcaError extends Error {
    code;
    hint;
    constructor(code, message, hint) {
        super(message);
        this.name = 'ScriptcaError';
        this.code = code;
        this.hint = hint;
    }
}
export class ScriptcaToolchainError extends ScriptcaError {
    constructor(message, hint) {
        super('SCRIPTC_TOOLCHAIN', message, hint);
        this.name = 'ScriptcaToolchainError';
    }
}
export class ScriptcaContractError extends ScriptcaError {
    constructor(message, hint) {
        super('CONTRACT', message, hint);
        this.name = 'ScriptcaContractError';
    }
}
//# sourceMappingURL=index.js.map