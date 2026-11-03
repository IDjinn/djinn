import * as monaco from 'monaco-editor';

function definition(): monaco.languages.IMonarchLanguage {
    return {
        defaultToken: 'invalid',
        keywords: [
            'void', 'return', 'auto', 'extern', 'struct', 'namespace', 'import', 'mut', 'if', 'else', 'for',
            'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'interface', 'public', 'private',
            'static', 'unsafe', 'this', 'enum', 'new', 'impl', 'where', 'async', 'await', 'yield', 'spawn',
            'in', 'true', 'false', 'operator', 'const', 'constexpr', 'consteval', 'macro', 'is', 'null',
            'throw', 'throws', 'try', 'require', 'ensure',
        ],
        typeKeywords: [
            'i8', 'i16', 'i32', 'i64', 'u8', 'u16', 'u32', 'u64', 'f32', 'f64', 'bool', 'nint', 'usize',
            'str', 'string', 'object',
        ],
        operators: [
            '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '&&', '||', '+', '-', '*', '/', '&',
            '|', '^', '%', '<<', '>>', '->', '..', '??',
        ],
        symbols: /[=><!~?:&|+\-*/^%.]+/,
        escapes: /\\(?:[abfnrtv\\"'0]|x[0-9A-Fa-f]{2})/,
        tokenizer: {
            root: [
                [/\[[A-Za-z_][\w:]*/, 'annotation'],
                [
                    /[A-Za-z_]\w*/,
                    {cases: {'@typeKeywords': 'keyword.type', '@keywords': 'keyword', '@default': 'identifier'}},
                ],
                {include: '@whitespace'},
                [/[{}()[\]]/, '@brackets'],
                [/@symbols/, {cases: {'@operators': 'operator', '@default': ''}}],
                [/\d+\.\d+([eE][-+]?\d+)?/, 'number.float'],
                [/0[xX][0-9a-fA-F_]+/, 'number.hex'],
                [/\d[\d_]*/, 'number'],
                [/[;,.]/, 'delimiter'],
                [/\$"/, {token: 'string.quote', next: '@interpolated'}],
                [/"/, {token: 'string.quote', next: '@string'}],
                [/'[^\\']'/, 'string'],
                [/'/, 'string.invalid'],
            ],
            whitespace: [
                [/[ \t\r\n]+/, 'white'],
                [/\/\*/, 'comment', '@comment'],
                [/\/\/.*$/, 'comment'],
            ],
            comment: [
                [/[^/*]+/, 'comment'],
                [/\*\//, 'comment', '@pop'],
                [/[/*]/, 'comment'],
            ],
            string: [
                [/[^\\"]+/, 'string'],
                [/@escapes/, 'string.escape'],
                [/\\./, 'string.escape.invalid'],
                [/"/, {token: 'string.quote', next: '@pop'}],
            ],
            interpolated: [
                [/\{\{|\}\}/, 'string.escape'],
                [/\{/, {token: 'delimiter.bracket', next: '@interpolation'}],
                [/[^\\"{}]+/, 'string'],
                [/@escapes/, 'string.escape'],
                [/"/, {token: 'string.quote', next: '@pop'}],
            ],
            interpolation: [
                [/\}/, {token: 'delimiter.bracket', next: '@pop'}],
                {include: 'root'},
            ],
        },
    } as monaco.languages.IMonarchLanguage;
}

const config: monaco.languages.LanguageConfiguration = {
    comments: {lineComment: '//', blockComment: ['/*', '*/']},
    brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')'],
    ],
    autoClosingPairs: [
        {open: '{', close: '}'},
        {open: '[', close: ']'},
        {open: '(', close: ')'},
        {open: '"', close: '"', notIn: ['string']},
    ],
    surroundingPairs: [
        {open: '{', close: '}'},
        {open: '[', close: ']'},
        {open: '(', close: ')'},
        {open: '"', close: '"'},
    ],
};

monaco.languages.register({id: 'djinn'});
monaco.languages.setMonarchTokensProvider('djinn', definition());
monaco.languages.setLanguageConfiguration('djinn', config);
