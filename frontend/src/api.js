import axios from 'axios';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// ─── Parse & Generate ────────────────────────────────────────────────────────
export const generateEmails = (fullName, companyName, opts = {}) =>
    axios.post(`${API}/api/generate-emails`, { fullName, companyName, ...opts });

export const verifyEmail = (email, pattern) =>
    axios.post(`${API}/api/verify-email`, { email, pattern });

export const validateEmailAdvanced = (email, pattern, score) =>
    axios.post(`${API}/api/validate-email`, { email, pattern, score });

export const validateBatchEmails = (emails, skipSmtp = false) =>
    axios.post(`${API}/api/validate-batch`, { emails, skipSmtp });

export const parseLinkedIn = (rawText) =>
    axios.post(`${API}/api/parse-linkedin`, { rawText });

export const parseBulkLinkedIn = (rawText) =>
    axios.post(`${API}/api/parse-linkedin-bulk`, { rawText });

/**
 * runIntelligencePipeline: Unified single-button pipeline via SSE.
 */
export function runIntelligencePipeline(rawText, onEvent, sessionName = null, companyOverride = null, opts = {}) {
    const controller = new AbortController();
    const { excludeInterns = true, excludeFreshers = false, domainOverride = null } = opts;

    fetch(`${API}/api/run-pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText, sessionName, companyOverride: companyOverride || undefined, domainOverride: domainOverride || undefined, excludeInterns, excludeFreshers }),
        signal: controller.signal,
    }).then(async (res) => {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const messages = buffer.split('\n\n');
            buffer = messages.pop();

            for (const msg of messages) {
                if (msg.startsWith('data: ')) {
                    try {
                        const json = JSON.parse(msg.slice(6));
                        onEvent(json);
                    } catch (_) {}
                }
            }
        }
    }).catch((err) => {
        if (err.name !== 'AbortError') {
            onEvent({ type: 'error', data: { message: err.message } });
        }
    });

    return () => controller.abort();
}

// ─── Analytics ────────────────────────────────────────────────────────────────
export const getAnalytics = () => axios.get(`${API}/api/analytics`);
export const getOverviewStats = () => axios.get(`${API}/api/analytics/overview`);
export const getVerificationStats = () => axios.get(`${API}/api/analytics/verification-stats`);
export const getCompanyBreakdown = () => axios.get(`${API}/api/analytics/company-breakdown`);
export const getSessionTrends = () => axios.get(`${API}/api/analytics/session-trends`);
export const getRecruiterInsights = () => axios.get(`${API}/api/analytics/recruiter-insights`);

// ─── Leads ────────────────────────────────────────────────────────────────────
export const getLeads = (params) => axios.get(`${API}/api/leads`, { params });
export const getLead = (id) => axios.get(`${API}/api/leads/${id}`);
export const updateLead = (id, data) => axios.patch(`${API}/api/leads/${id}`, data);
export const deleteLead = (id) => axios.delete(`${API}/api/leads/${id}`);
export const bulkDeleteLeads = (ids) => axios.post(`${API}/api/leads/bulk-delete`, { ids });
export const patchLeadStatus = (id, data) => axios.patch(`${API}/api/leads/${id}/status`, data);

// ─── Companies ────────────────────────────────────────────────────────────────
export const getCompanies = () => axios.get(`${API}/api/companies`);
export const getCompany = (id) => axios.get(`${API}/api/companies/${id}`);

// ─── Sessions ─────────────────────────────────────────────────────────────────
export const getSessions = (params) => axios.get(`${API}/api/sessions`, { params });
export const getSession = (id) => axios.get(`${API}/api/sessions/${id}`);
export const deleteSession = (id) => axios.delete(`${API}/api/sessions/${id}`);
export const archiveSession = (id, isArchived = true) => axios.patch(`${API}/api/sessions/${id}/archive`, { isArchived });

// ─── Logs ─────────────────────────────────────────────────────────────────────
export const getLogs = (params) => axios.get(`${API}/api/logs`, { params });

// ─── Exports ──────────────────────────────────────────────────────────────────
export const getExports = () => axios.get(`${API}/api/exports`);
export const exportLeads = (format, sessionId) =>
    axios.post(`${API}/api/export`, { format, sessionId }, { responseType: 'blob' });

// ─── Google Sheets ────────────────────────────────────────────────────────────
export const getGoogleSheetsStatus = () => axios.get(`${API}/api/google-sheets/status`);
export const getGoogleSheetsSessions = () => axios.get(`${API}/api/google-sheets/sessions`);
export const createGoogleSheet = (title) => axios.post(`${API}/api/google-sheets/create`, { title });
export const syncToSheets = (payload) => axios.post(`${API}/api/google-sheets/sync`, payload);
export const clearGoogleSheet = (spreadsheetId, sheetName) =>
    axios.post(`${API}/api/google-sheets/clear`, { spreadsheetId, sheetName });

/**
 * processBulkStream: Opens an SSE connection to /bulk-process-stream
 */
export function processBulkStream(profiles, onEvent, verify = false, sessionName = null) {
    const controller = new AbortController();

    fetch(`${API}/api/bulk-process-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profiles, verify, sessionName }),
        signal: controller.signal,
    }).then(async (res) => {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const messages = buffer.split('\n\n');
            buffer = messages.pop();

            for (const msg of messages) {
                if (msg.startsWith('data: ')) {
                    try {
                        const json = JSON.parse(msg.slice(6));
                        onEvent(json);
                    } catch (_) {}
                }
            }
        }
    }).catch((err) => {
        if (err.name !== 'AbortError') {
            console.error('Stream error:', err);
            onEvent({ type: 'error', data: { message: err.message } });
        }
    });

    return () => controller.abort();
}

// ─── Extension / Realtime ─────────────────────────────────────────────────────
export const pingExtensionBackend = () => axios.get(`${API}/api/extension/ping`);
export const processExtensionLeads = (payload) => axios.post(`${API}/api/leads/process`, payload);
export const getEventsStreamUrl = () => `${API}/api/events/stream`;

// ─── Outreach / Campaigns ─────────────────────────────────────────────────────
export const getOutreachStats = () => axios.get(`${API}/api/outreach/stats`);
export const getOutreachCampaigns = () => axios.get(`${API}/api/outreach/campaigns`);
export const getCampaign = (id) => axios.get(`${API}/api/outreach/campaigns/${id}`);
export const createCampaign = (data) => axios.post(`${API}/api/outreach/campaigns`, data);
export const updateCampaign = (id, data) => axios.patch(`${API}/api/outreach/campaigns/${id}`, data);
export const deleteCampaign = (id) => axios.delete(`${API}/api/outreach/campaigns/${id}`);

export const sendOutreachEmail = (data) => axios.post(`${API}/api/outreach/send`, data);
export const sendBatchEmails = (emails) => axios.post(`${API}/api/outreach/send-batch`, { emails });
export const getSentEmails = (params) => axios.get(`${API}/api/outreach/sent`, { params });
export const getSessionLeads = (sessionId) => {
    // Support both single ID and array of IDs
    if (Array.isArray(sessionId)) {
        return axios.get(`${API}/api/outreach/session-leads`, { params: { sessionIds: sessionId.join(',') } });
    }
    return axios.get(`${API}/api/outreach/session-leads`, { params: { sessionId } });
};
export const bulkSendTemplate = (data) => axios.post(`${API}/api/outreach/bulk-send-template`, data);

export const getTemplates = () => axios.get(`${API}/api/outreach/templates`);
export const renderTemplate = (templateId, variables) => axios.post(`${API}/api/outreach/templates/render`, { templateId, variables });

export const generateAIEmail = (data) => axios.post(`${API}/api/outreach/generate`, data);
export const generateAIVariants = (data) => axios.post(`${API}/api/outreach/generate-variants`, data);

// ─── Email Queue ──────────────────────────────────────────────────────────────
export const getQueueStats = () => axios.get(`${API}/api/outreach/queue/stats`);
export const getQueueJobs = (params) => axios.get(`${API}/api/outreach/queue/jobs`, { params });
export const addToQueue = (data) => axios.post(`${API}/api/outreach/queue/add`, data);
export const startQueue = () => axios.post(`${API}/api/outreach/queue/start`);
export const pauseQueue = () => axios.post(`${API}/api/outreach/queue/pause`);
export const resumeQueue = () => axios.post(`${API}/api/outreach/queue/resume`);
export const stopQueue = () => axios.post(`${API}/api/outreach/queue/stop`);
export const retryDeadQueue = () => axios.post(`${API}/api/outreach/queue/retry-dead`);

// ─── User Assets (Persistent Identity Manager) ───────────────────────────────
export const getResumes = () => axios.get(`${API}/api/assets/resumes`);
export const createResume = (data) => axios.post(`${API}/api/assets/resumes`, data);
export const updateResume = (id, data) => axios.patch(`${API}/api/assets/resumes/${id}`, data);
export const deleteResume = (id) => axios.delete(`${API}/api/assets/resumes/${id}`);

export const getProfiles = () => axios.get(`${API}/api/assets/profiles`);
export const createProfile = (data) => axios.post(`${API}/api/assets/profiles`, data);
export const updateProfile = (id, data) => axios.patch(`${API}/api/assets/profiles/${id}`, data);
export const deleteProfile = (id) => axios.delete(`${API}/api/assets/profiles/${id}`);

export const getSignatures = () => axios.get(`${API}/api/assets/signatures`);
export const createSignature = (data) => axios.post(`${API}/api/assets/signatures`, data);
export const deleteSignature = (id) => axios.delete(`${API}/api/assets/signatures/${id}`);

export const getDefaultAssets = () => axios.get(`${API}/api/assets/defaults`);

// ─── Validation ───────────────────────────────────────────────────────────────
export const validateLead = (leadId, skipSmtp = false, force = false) => axios.post(`${API}/api/outreach/validate-lead`, { leadId, skipSmtp, force });
export const validateSessionEmails = (sessionId, skipSmtp = false, force = false) => axios.post(`${API}/api/outreach/validate-session`, { sessionId, skipSmtp, force });
export const validateAllEmails = (force = false) => axios.post(`${API}/api/outreach/validate-all`, { force });

// ─── Follow-Ups ──────────────────────────────────────────────────────────────
export const scheduleFollowUps = (campaignId) => axios.post(`${API}/api/outreach/follow-ups/schedule`, { campaignId });
export const processFollowUps = () => axios.post(`${API}/api/outreach/follow-ups/process`);
export const getFollowUps = (params) => axios.get(`${API}/api/outreach/follow-ups`, { params });

// ─── Import ───────────────────────────────────────────────────────────────────
export const importFile = (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return axios.post(`${API}/api/import/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });
};
export const getImportSessions = () => axios.get(`${API}/api/import/sessions`);

// ─── Conversations / Threads ──────────────────────────────────────────────────
export const getConversations = (params) => axios.get(`${API}/api/outreach/conversations`, { params });
export const getCampaignHistory = (params) => axios.get(`${API}/api/outreach/history`, { params });
export const previewEmail = (data) => axios.post(`${API}/api/outreach/preview`, data);
