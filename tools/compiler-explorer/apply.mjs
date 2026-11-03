import fs from 'node:fs';
import path from 'node:path';

const [, , ceDir, filesDir] = process.argv;

function copyTree(from, to) {
    for (const entry of fs.readdirSync(from, {withFileTypes: true})) {
        const source = path.join(from, entry.name);
        const target = path.join(to, entry.name);
        if (entry.isDirectory()) {
            fs.mkdirSync(target, {recursive: true});
            copyTree(source, target);
        } else {
            fs.copyFileSync(source, target);
        }
    }
}

function patch(file, marker, anchor, insertion) {
    const full = path.join(ceDir, file);
    const text = fs.readFileSync(full, 'utf8');
    if (text.includes(marker)) {
        return;
    }
    if (!text.includes(anchor)) {
        throw new Error(`anchor not found in ${file}: ${anchor}`);
    }
    fs.writeFileSync(full, text.replace(anchor, insertion + anchor));
}

copyTree(filesDir, ceDir);

patch(
    'lib/languages.ts',
    "djinn: {",
    '    zig: {',
    `    djinn: {
        name: 'Djinn',
        monaco: 'djinn',
        extensions: ['.djinn'],
        alias: [],
        logoFilename: 'djinn.svg',
        logoFilenameDark: null,
        formatter: null,
        previewFilter: null,
        monacoDisassembly: null,
    },
`,
);
patch('types/languages.interfaces.ts', "'djinn'", "    | 'zig';", "    | 'djinn'\n");
patch('lib/compilers/_all.ts', 'DjinnCompiler', "export {ZigCompiler}", "export {DjinnCompiler} from './djinn.js';\n");
patch('static/modes/_all.ts', 'djinn-mode', "import './zig-mode';", "import './djinn-mode';\n");
console.log('compiler explorer patched for djinn');
