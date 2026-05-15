/**
 * templates.js — Email template engine with variable replacement.
 * ─────────────────────────────────────────────────────────────────────────────
 * Templates use {{variable}} syntax for dynamic content.
 * All templates have HTML + plain text versions.
 */

// ─── Template Registry ───────────────────────────────────────────────────────

const TEMPLATES = {
    cold_outreach: {
        name: 'Cold Outreach',
        description: 'Initial cold email to a recruiter or hiring manager',
        subject: 'Quick question about {{role}} at {{company}}',
        html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; color: #1a1a1a; line-height: 1.6;">
  <p>Hi {{recruiterFirstName}},</p>
  <p>I came across your profile and noticed you're working on {{role}} hiring at <strong>{{company}}</strong>. I'm a {{myRole}} with experience in {{skills}}, and I'd love to explore if there's a fit.</p>
  <p>I've been working on {{recentWork}}, and I'm particularly excited about what {{company}} is building.</p>
  <p>Would you be open to a quick 10-minute chat this week?</p>
  <p>Best,<br/>{{myName}}</p>
  <p style="font-size: 12px; color: #666;">{{myTitle}}</p>
</div>`,
        text: `Hi {{recruiterFirstName}},

I came across your profile and noticed you're working on {{role}} hiring at {{company}}. I'm a {{myRole}} with experience in {{skills}}, and I'd love to explore if there's a fit.

I've been working on {{recentWork}}, and I'm particularly excited about what {{company}} is building.

Would you be open to a quick 10-minute chat this week?

Best,
{{myName}}
{{myTitle}}`,
    },

    referral_request: {
        name: 'Referral Request',
        description: 'Asking for a referral from a connection at the company',
        subject: 'Would you be open to a referral for {{role}} at {{company}}?',
        html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; color: #1a1a1a; line-height: 1.6;">
  <p>Hi {{recruiterFirstName}},</p>
  <p>I hope this message finds you well! I noticed you're at <strong>{{company}}</strong> and I'm very interested in the {{role}} position that's currently open.</p>
  <p>A bit about me: I'm a {{myRole}} with {{experience}} of experience in {{skills}}. {{recentWork}}</p>
  <p>Would you be open to referring me or pointing me to the right person on the team? I'd be happy to share my resume and portfolio.</p>
  <p>Either way, I appreciate your time!</p>
  <p>Thanks,<br/>{{myName}}</p>
</div>`,
        text: `Hi {{recruiterFirstName}},

I hope this message finds you well! I noticed you're at {{company}} and I'm very interested in the {{role}} position that's currently open.

A bit about me: I'm a {{myRole}} with {{experience}} of experience in {{skills}}. {{recentWork}}

Would you be open to referring me or pointing me to the right person on the team? I'd be happy to share my resume and portfolio.

Either way, I appreciate your time!

Thanks,
{{myName}}`,
    },

    follow_up: {
        name: 'Follow Up',
        description: 'Follow-up email after no response',
        subject: 'Re: {{role}} at {{company}} — following up',
        html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; color: #1a1a1a; line-height: 1.6;">
  <p>Hi {{recruiterFirstName}},</p>
  <p>I wanted to follow up on my previous message about the {{role}} opportunity at <strong>{{company}}</strong>.</p>
  <p>I understand you're busy — just wanted to reiterate my interest. I've {{recentUpdate}} since my last email, which I think makes me an even stronger fit.</p>
  <p>Happy to work around your schedule if you'd like to connect.</p>
  <p>Best,<br/>{{myName}}</p>
</div>`,
        text: `Hi {{recruiterFirstName}},

I wanted to follow up on my previous message about the {{role}} opportunity at {{company}}.

I understand you're busy — just wanted to reiterate my interest. I've {{recentUpdate}} since my last email, which I think makes me an even stronger fit.

Happy to work around your schedule if you'd like to connect.

Best,
{{myName}}`,
    },

    networking: {
        name: 'Networking',
        description: 'General networking / coffee chat request',
        subject: 'Fellow {{industry}} professional — quick connect?',
        html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; color: #1a1a1a; line-height: 1.6;">
  <p>Hi {{recruiterFirstName}},</p>
  <p>I've been following {{company}}'s work in {{industry}} and I'm impressed by what you're building. As a {{myRole}}, I'd love to learn more about your team's approach.</p>
  <p>Would you be open to a brief virtual coffee? No ask — just genuinely curious about your experience at {{company}}.</p>
  <p>Cheers,<br/>{{myName}}</p>
</div>`,
        text: `Hi {{recruiterFirstName}},

I've been following {{company}}'s work in {{industry}} and I'm impressed by what you're building. As a {{myRole}}, I'd love to learn more about your team's approach.

Would you be open to a brief virtual coffee? No ask — just genuinely curious about your experience at {{company}}.

Cheers,
{{myName}}`,
    },

    startup_founder: {
        name: 'Startup Founder Tone',
        description: 'Direct, founder-style outreach',
        subject: '{{myName}} → {{company}} — let\'s talk {{role}}',
        html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; color: #1a1a1a; line-height: 1.6;">
  <p>Hey {{recruiterFirstName}},</p>
  <p>Straight to the point: I'm a {{myRole}} who ships fast and I want to work at {{company}}.</p>
  <p>{{recentWork}}</p>
  <p>I've got {{experience}} building {{skills}} and I think I can add real value to your {{role}} team.</p>
  <p>5 minutes of your time — that's all I'm asking. When works?</p>
  <p>— {{myName}}</p>
</div>`,
        text: `Hey {{recruiterFirstName}},

Straight to the point: I'm a {{myRole}} who ships fast and I want to work at {{company}}.

{{recentWork}}

I've got {{experience}} building {{skills}} and I think I can add real value to your {{role}} team.

5 minutes of your time — that's all I'm asking. When works?

— {{myName}}`,
    },
};

// ─── Template Engine ─────────────────────────────────────────────────────────

/**
 * Replace {{variable}} placeholders with actual values.
 * @param {string} template - template string with {{vars}}
 * @param {object} variables - key-value pairs
 * @returns {string}
 */
function renderTemplate(template, variables = {}) {
    let rendered = template;
    for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        rendered = rendered.replace(regex, value || '');
    }
    // Remove any unreplaced variables
    rendered = rendered.replace(/\{\{[^}]+\}\}/g, '');
    return rendered.trim();
}

/**
 * Get a fully rendered template.
 * @param {string} templateId - template key
 * @param {object} variables - replacement variables
 * @returns {{ subject, html, text, templateId }}
 */
function getRenderedTemplate(templateId, variables = {}) {
    const template = TEMPLATES[templateId];
    if (!template) {
        throw new Error(`Template "${templateId}" not found. Available: ${Object.keys(TEMPLATES).join(', ')}`);
    }

    return {
        templateId,
        subject: renderTemplate(template.subject, variables),
        html: renderTemplate(template.html, variables),
        text: renderTemplate(template.text, variables),
    };
}

/**
 * List all available templates.
 */
function listTemplates() {
    return Object.entries(TEMPLATES).map(([id, t]) => ({
        id,
        name: t.name,
        description: t.description,
        subjectPreview: t.subject,
    }));
}

module.exports = {
    TEMPLATES,
    renderTemplate,
    getRenderedTemplate,
    listTemplates,
};
