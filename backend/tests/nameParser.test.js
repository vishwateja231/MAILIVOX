const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseName, sanitizeLinkedInName } = require('../services/nameParser');

describe('sanitizeLinkedInName', () => {
    it('strips connection degree markers', () => {
        assert.strictEqual(sanitizeLinkedInName('Jane Smith • 2nd'), 'Jane Smith');
        assert.strictEqual(sanitizeLinkedInName('Alex Kumar · 1st'), 'Alex Kumar');
    });

    it('strips headline and location after degree', () => {
        assert.strictEqual(
            sanitizeLinkedInName('Alex Kumar • 1stSDE1 @ TechCorp || Ex Infosys'),
            'Alex Kumar'
        );
        assert.strictEqual(
            sanitizeLinkedInName('Priya Sharma • 2ndSDE I @ TechCorp | Ex-CiscoHyderabad, Telangana, India'),
            'Priya Sharma'
        );
    });

    it('handles repeated names', () => {
        assert.strictEqual(sanitizeLinkedInName('John Doe———John Doe'), 'John Doe');
    });

    it('preserves clean names', () => {
        assert.strictEqual(sanitizeLinkedInName('SARAH JOHNSON R'), 'SARAH JOHNSON R');
        assert.strictEqual(sanitizeLinkedInName('Maria Garcia'), 'Maria Garcia');
    });

    it('removes emojis', () => {
        const result = sanitizeLinkedInName('John 🚀 Doe');
        assert.ok(result.includes('John') && result.includes('Doe'));
    });

    it('handles empty/null input', () => {
        assert.strictEqual(sanitizeLinkedInName(''), '');
        assert.strictEqual(sanitizeLinkedInName(null), '');
        assert.strictEqual(sanitizeLinkedInName(undefined), '');
    });
});

describe('parseName', () => {
    it('parses simple two-part names', () => {
        const result = parseName('John Doe');
        assert.strictEqual(result.first, 'john');
        assert.strictEqual(result.last, 'doe');
    });

    it('parses three-part names', () => {
        const result = parseName('James Robert Smith');
        assert.strictEqual(result.first, 'james');
        assert.strictEqual(result.last, 'smith');
        assert.ok(result.middle.includes('robert'));
    });

    it('handles single names', () => {
        const result = parseName('Alex');
        assert.strictEqual(result.first, 'alex');
        assert.strictEqual(result.last, '');
    });

    it('sanitizes LinkedIn garbage before parsing', () => {
        const result = parseName('Jane Smith • 2ndSDE2 @techcorpHyderabad');
        assert.strictEqual(result.first, 'jane');
        assert.strictEqual(result.last, 'smith');
    });

    it('returns empty for null input', () => {
        const result = parseName(null);
        assert.strictEqual(result.first, '');
        assert.strictEqual(result.last, '');
    });
});
