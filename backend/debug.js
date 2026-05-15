const { parseBulkLinkedInText } = require('./services/bulkParser');

// Simulate the exact same multi-profile text as test.js
const multiBlock = "Mahendranath Jinkathoti \u2022 2nd\nData Scientist at Honeywell | NITK'25 | CBIT'23\nIndia\nPending\n\nShamita Singh\n\u00b7 2nd\nRecruitment Specialist || Honeywell\nGurugram, Haryana, India\n\nJean-Pierre Dubois\nSoftware Engineer @ Google\nParis, France\n2nd Connection";

const result = parseBulkLinkedInText(multiBlock);
console.log('blocks found:', result.totalFound);
console.log('valid profiles:', result.totalValid);
result.profiles.forEach(p => console.log('Name:', p.fullName, '| Company:', p.company, '| Role:', p.role));
