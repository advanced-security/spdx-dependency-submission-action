import js from '@eslint/js';
import globals from 'globals';

export default [
    js.configs.recommended,
    {
        ignores: ['dist/', 'node_modules/']
    },
    {
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.es6,
                ...globals.jest
            }
        },
        rules: {}
    }
];
