const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseLinkedInText } = require('../services/linkedInParser');

describe('parseLinkedInText', () => {
    it('parses simple "name company" input', () => {
        const result = parseLinkedInText('alex apple');
        assert.ok(result.fullName, 'Should extract a name');
        assert.strictEqual(result.company.toLowerCase(), 'apple');
    });

    it('parses "name@domain.com" email input', () => {
        const result = parseLinkedInText('jane@techcorp.com');
        assert.ok(result.providedEmail, 'Should detect provided email');
        assert.strictEqual(result.providedEmail, 'jane@techcorp.com');
    });

    it('parses LinkedIn multi-line paste', () => {
        const input = `John Doe
Senior Software Engineer at TechCorp
Bangalore, India`;
        const result = parseLinkedInText(input);
        assert.strictEqual(result.fullName.toLowerCase(), 'john doe');
        assert.ok(result.company.toLowerCase().includes('techcorp'), `Expected TechCorp, got: ${result.company}`);
    });

    it('extracts role from headline', () => {
        const input = `Jane Smith
Recruitment Specialist || BigCompany
Mumbai, India`;
        const result = parseLinkedInText(input);
        assert.ok(result.role, 'Should extract role');
    });

    it('handles empty input gracefully', () => {
        const result = parseLinkedInText('');
        assert.ok(result.error, 'Should return error for empty input');
    });

    it('handles noise-heavy LinkedIn text', () => {
        const input = `Robert Johnson
SDE II | Gen AI | Cloud
Hyderabad, Telangana, India
Current: SDE II at MegaCorp
Some Person, Another One and 1 other mutual connection`;
        const result = parseLinkedInText(input);
        assert.strictEqual(result.fullName.toLowerCase(), 'robert johnson');
    });
});
