const axios = require('axios');

const API = 'http://localhost:3000/api';

async function run() {
    // Test 1: Single LinkedIn profile parse
    console.log('\n═══ TEST 1: Single LinkedIn Parse ═══');
    const singleRes = await axios.post(`${API}/parse-linkedin`, {
        rawText: `Shamita Singh
· 2nd

Recruitment Specialist || Honeywell

Gurugram, Haryana, India

·

Contact info

Honeywell

25,602 followers`
    });
    console.log(JSON.stringify(singleRes.data, null, 2));

    // Test 2: Bulk parse  
    console.log('\n\u2550\u2550\u2550 TEST 2: Bulk LinkedIn Parse \u2550\u2550\u2550');
    const bulkRes = await axios.post(`${API}/parse-linkedin-bulk`, {
        rawText: `Mahendranath Jinkathoti \u2022 2nd\nData Scientist at Honeywell | NITK'25 | CBIT'23\nIndia\nPending\n\nShamita Singh\n\u00b7 2nd\nRecruitment Specialist || Honeywell\nGurugram, Haryana, India\n\nJean-Pierre Dubois\nSoftware Engineer @ Google\nParis, France\n2nd Connection`
    });
    console.log(`Total blocks found: ${bulkRes.data.totalFound}`);
    console.log(`Valid profiles: ${bulkRes.data.totalValid}`);
    bulkRes.data.profiles.forEach((p, i) => {
        console.log(`\n[${i+1}] ${p.fullName} | ${p.company} | ${p.role}`);
    });
}

run().catch(err => console.error('Test failed:', err.response?.data || err.message));
