import path from 'node:path';

import type {ParseFiltersAndOutputOptions} from '../../types/features/filters.interfaces.js';
import type {ResultLine} from '../../types/resultline/resultline.interfaces.js';
import {BaseCompiler} from '../base-compiler.js';

export class DjinnCompiler extends BaseCompiler {
    static get key() {
        return 'djinn';
    }

    constructor(info: any, env: any) {
        super(info, env);
        this.compiler.supportsIrView = true;
        this.compiler.supportsAstView = true;
        this.compiler.irArg = ['--emit-ir'];
    }

    override optionsForFilter(filters: ParseFiltersAndOutputOptions, outputFilename: string): string[] {
        if (filters.binary) {
            return ['-o', outputFilename];
        }
        return ['--emit-asm', '-g', '-o', outputFilename];
    }

    protected override getSharedLibraryPathsAsArguments(): string[] {
        return [];
    }

    override getIrOutputFilename(inputFilename: string): string {
        const outputFilename = this.getOutputFilename(path.dirname(inputFilename), this.outputFilebase);
        return this.filename(outputFilename + '.ll');
    }

    override couldSupportASTDump(): boolean {
        return true;
    }

    override async generateAST(inputFilename: string, options: string[]): Promise<ResultLine[]> {
        const astOptions = options.filter(option => option !== '--emit-asm').concat(['--emit-ast']);
        const execOptions = this.getDefaultExecOptions();
        const result = await this.runCompiler(this.compiler.exe, astOptions, this.filename(inputFilename), execOptions);
        return result.stdout.map(line => {
            const match = line.text.match(/^(.*) <(\d+):(\d+)>$/);
            if (!match) {
                return line;
            }
            return {text: match[1], source: {file: null, line: Number(match[2]), mainsource: true}};
        });
    }
}
