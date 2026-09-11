// /api/lead (public form endpoint, default) and /api/leads (staff list + status, rewritten here as ?fn=admin)
const dispatch = require('../lib/api/_dispatch.js');
module.exports = dispatch({ lead: require('../lib/api/lead.js'), admin: require('../lib/api/leads.js') }, 'lead');
