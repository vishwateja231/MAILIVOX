const { describe, it } = require('node:test');
const assert = require('node:assert');
const { generatePermutations } = require('../services/generator');
const { parseName } = require('../services/nameParser');

describe('generatePermutations', () => {
    it('generates patterns for standard two-part name', () => {
        const parsed = parseName('John Doe');
        const perms = generatePermutations(parsed, 'example.com');

        assert.ok(perms.length >= 5, `Expected at least 5 permutations, got ${perms.length}`);

        const emails = perms.map(p => p.email);
        assert.ok(emails.includes('john.doe@example.com') || emails.includes('johndoe@example.com'),
            'Should include firstname.lastname or firstnamelastname');
        assert.ok(emails.every(e => e.endsWith('@example.com')), 'All should end with @example.com');
    });

    it('all emails have correct domain', () => {
        const parsed = parseName('Jane Smith');
        const perms = generatePermutations(parsed, 'company.io');
        const emails = perms.map(p => p.email);
        assert.ok(emails.every(e => e.endsWith('@company.io')), 'All should end with @company.io');
    });

    it('handles single name gracefully', () => {
        const parsed = parseName('Alex');
        const perms = generatePermutations(parsed, 'startup.com');
        assert.ok(perms.length >= 1, 'Should generate at least 1 permutation for single name');
        assert.ok(perms.every(p => p.email.endsWith('@startup.com')));
    });

    it('handles three-part names', () => {
        const parsed = parseName('James Robert Smith');
        const perms = generatePermutations(parsed, 'corp.com');
        assert.ok(perms.length >= 3, 'Should generate patterns for three-part names');
        assert.ok(perms.every(p => p.email.endsWith('@corp.com')));
    });

    it('each permutation has email and pattern', () => {
        const parsed = parseName('Sarah Connor');
        const perms = generatePermutations(parsed, 'skynet.io');
        assert.ok(perms.every(p => p.email && p.email.includes('@')), 'All must have valid email');
        assert.ok(perms.every(p => p.pattern && p.pattern.length > 0), 'All must have pattern label');
    });
});
