const { describe, it } = require('node:test');
const assert = require('node:assert');
const { validateSyntax } = require('../services/validation/validationEngine');

describe('validateSyntax', () => {
    it('accepts valid emails', () => {
        const valid = [
            'john.doe@company.com',
            'j.doe@sub.domain.co.uk',
            'firstname_lastname@example.org',
            'user+tag@gmail.com',
            'name@startup.io',
        ];
        for (const email of valid) {
            const result = validateSyntax(email);
            assert.strictEqual(result.valid, true, `Expected ${email} to be valid`);
        }
    });

    it('rejects clearly invalid emails', () => {
        const invalid = [
            '',
            'notanemail',
            '@nodomain.com',
            'noat.com',
            'spaces in@email.com',
            'double@@at.com',
        ];
        for (const email of invalid) {
            const result = validateSyntax(email);
            assert.strictEqual(result.valid, false, `Expected "${email}" to be invalid`);
        }
    });

    it('extracts domain from valid email', () => {
        const result = validateSyntax('user@amazon.com');
        assert.ok(result.valid);
        assert.ok(result.domain.includes('amazon'));
    });
});
