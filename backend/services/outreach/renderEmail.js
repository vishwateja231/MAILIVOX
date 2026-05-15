/**
 * renderEmail.js — Production email renderer for Mailivox outreach.
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles REAL textarea input (typed Enter keys, pasted content, multiline).
 * Normalizes all newline formats (CRLF, CR, LF) before processing.
 *
 * Rules:
 *   - Double newline (\n\n) = new paragraph
 *   - Single newline (\n) = <br> line break within paragraph
 *   - URLs auto-detected and made clickable
 *   - Signature lines (Best regards, + name) kept grouped
 */

/**
 * Replace template variables with values.
 */
function replaceVariables(template, vars) {
    let result = template;
    for (const [key, val] of Object.entries(vars)) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
        result = result.replace(regex, val || '');
    }
    // Remove any unreplaced {{variables}}
    result = result.replace(/\{\{[^}]+\}\}/g, '');
    return result.trim();
}

/**
 * Detect URLs and convert to clickable links.
 */
function linkify(text) {
    return text.replace(
        /(https?:\/\/[^\s<>"']+)/gi,
        '<a href="$1" style="color:#2563eb;text-decoration:underline;">$1</a>'
    );
}

/**
 * Convert plain text body to email-safe HTML.
 * Handles real textarea input with proper newline normalization.
 */
function textToHtml(text) {
    // Step 1: Normalize all newline formats
    const normalized = text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();

    // Step 2: Split into paragraphs by double newline (with optional whitespace between)
    const paragraphs = normalized.split(/\n\s*\n/).filter(Boolean);

    // Step 3: Convert each paragraph to HTML
    const htmlParagraphs = paragraphs.map(paragraph => {
        // Within a paragraph, convert single newlines to <br>
        const withBreaks = paragraph
            .split('\n')
            .map(line => linkify(line))
            .join('<br>\n');

        return `<p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;color:#111827;">${withBreaks}</p>`;
    });

    return htmlParagraphs.join('\n');
}

/**
 * Render a complete outreach email.
 * @param {object} opts
 * @param {string} opts.subject - email subject template
 * @param {string} opts.body - email body template (plain text with {{vars}})
 * @param {object} opts.vars - variable values
 * @returns {{ subject, html, text }}
 */
function renderEmail(opts) {
    const { subject, body, vars = {} } = opts;

    // Replace variables
    const renderedSubject = replaceVariables(subject, vars);
    const renderedBody = replaceVariables(body, vars);

    // Plaintext = rendered body as-is (normalized newlines)
    const text = renderedBody.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

    // HTML = proper email structure
    const bodyHtml = textToHtml(renderedBody);

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;">
<tr>
<td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr>
<td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
${bodyHtml}
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;

    return { subject: renderedSubject, html, text };
}

module.exports = { renderEmail, replaceVariables, textToHtml, linkify };
