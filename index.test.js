const { replaceVersionEscape  } = require('./index.js');

describe('replaceVersionEscape', () => {
    test('returns the purl unchanged when there is no escape issue', () => {
        const purl = 'pkg:generic/somepackage@1.0.0';
        expect(replaceVersionEscape(purl)).toBe(purl);
    });

    test('replaces the last occurrence of "%40" with "@"', () => {
        const purl = 'pkg:generic/somepackage%401.0.0';
        const expected = 'pkg:generic/somepackage@1.0.0';
        expect(replaceVersionEscape(purl)).toBe(expected);
    });

    test('replaces only the last occurrence of "%40" with "@" when multiple are present', () => {
        const purl = 'pkg:generic/some%40package%401.0.0';
        const expected = 'pkg:generic/some%40package@1.0.0';
        expect(replaceVersionEscape(purl)).toBe(expected);
    });

    test('returns the purl unchanged when "%40" is in the namespace', () => {
        const purl = 'pkg:generic/some%40package@1.0.0';
        expect(replaceVersionEscape(purl)).toBe(purl);
    });

    test('handles null gracefully', () => {
        const purl = null;
        expect(replaceVersionEscape(purl)).toBeNull();
    });

    test('handles undefined gracefully', () => {
        const purl = undefined;
        expect(replaceVersionEscape(purl)).toBeUndefined();
    });
});