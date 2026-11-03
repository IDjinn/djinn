import path from 'node:path';

import type {ParseFiltersAndOutputOptions} from '../../types/features/filters.interfaces.js';
import {BaseCompiler} from '../base-compiler.js';

export class DjinnCompiler extends BaseCompiler {
    static get key() {
        return 'djinn';
    }

    constructor(info: any, env: any) {
        super(info, env);
        this.compiler.supportsIrView = true;
        this.compiler.irArg = ['--emit-ir'];
    }

    override optionsForFilter(filters: ParseFiltersAndOutputOptions, outputFilename: string): string[] {
        if (filters.binary) {
            return ['-o', outputFilename];
        }
        return ['--emit-asm', '-o', outputFilename];
    }

    protected override getSharedLibraryPathsAsArguments(): string[] {
        return [];
    }

    override getIrOutputFilename(inputFilename: string): string {
        const outputFilename = this.getOutputFilename(path.dirname(inputFilename), this.outputFilebase);
        return this.filename(outputFilename + '.ll');
    }
}
