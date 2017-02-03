'use strict';
// =========================================================================
//
// Controller for inspectionreport
//
// =========================================================================
var path     = require('path');
var DBModel  = require (path.resolve('./modules/core/server/controllers/core.dbmodel.controller'));

module.exports = DBModel.extend ({
	name : 'complianceOversight',
	plural : 'complianceOversight',
	getForProject: function (projectId) {
		return this.list ({project:projectId});
	},
});

