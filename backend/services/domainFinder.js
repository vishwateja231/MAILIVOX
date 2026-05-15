const axios = require('axios');

async function findDomain(companyName) {
    try {
        const response = await axios.get(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(companyName)}`, {
             timeout: 5000
        });

        if (response.data && response.data.length > 0) {
            // Return the best match's domain
            return response.data[0].domain;
        }
        
        // Fallback or none found
        return null;
    } catch (error) {
        console.error('Error fetching domain from Clearbit:', error.message);
        return null;
    }
}

module.exports = { findDomain };
