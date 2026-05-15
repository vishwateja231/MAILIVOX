/**
 * features.js — Feature flags for safe incremental rollout.
 * ─────────────────────────────────────────────────────────────────────────────
 * If a feature is disabled, existing workflows continue working unchanged.
 */

const features = {
    autoValidation: process.env.ENABLE_AUTO_VALIDATION === 'true',
    followUps: process.env.ENABLE_FOLLOWUPS === 'true',
    realtime: process.env.ENABLE_REALTIME === 'true',
    bounceProtection: process.env.ENABLE_BOUNCE_PROTECTION === 'true',
};

function isEnabled(feature) {
    return features[feature] === true;
}

module.exports = { features, isEnabled };
