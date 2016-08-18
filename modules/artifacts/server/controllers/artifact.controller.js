'use strict';
// =========================================================================
//
// Controller for projects
//
// =========================================================================
var path = require('path');
var DBModel = require(path.resolve('./modules/core/server/controllers/core.dbmodel.controller'));
var Template = require(path.resolve('./modules/templates/server/controllers/template.controller'));
var ArtifactType = require('./artifact.type.controller');
var MilestoneClass = require(path.resolve('./modules/milestones/server/controllers/milestone.controller'));
var ActivityClass = require(path.resolve('./modules/activities/server/controllers/activity.controller'));
var PhaseClass = require(path.resolve('./modules/phases/server/controllers/phase.controller'));
// var Roles               = require (path.resolve('./modules/roles/server/controllers/role.controller'));
var _ = require('lodash');
var DocumentClass  = require (path.resolve('./modules/documents/server/controllers/core.document.controller'));
var Access    = require (path.resolve ('./modules/core/server/controllers/core.access.controller'));

module.exports = DBModel.extend({
	name: 'Artifact',
	plural: 'artifacts',
	populate: 'artifactType template document valuedComponents',
	bind: ['getCurrentTypes'],
	getForProject: function (projectid) {
		return this.list({project: projectid}, {
			name: 1,
			version: 1,
			stage: 1,
			isPublished: 1,
			userPermissions: 1,
			valuedComponents: 1,
			author: 1,
			shortDescription: 1,
			dateUpdated: 1,
			dateAdded: 1,
			addedBy: 1,
			updatedBy: 1
		});
	},
	// If we want artifacts that do not equal a certain type
	getForProjectFilterType: function (projectid, qs) {
		var q = {project: projectid};
		q.isPublished = qs.isPublished;
		q.typeCode = { '$nin': qs.typeCodeNe.split(',') };
		this.populate = 'artifactType template document valuedComponents addedBy updatedBy';
		return this.findMany(q, {
			name: 1,
			version: 1,
			stage: 1,
			isPublished: 1,
			userPermissions: 1,
			valuedComponents: 1,
			author: 1,
			shortDescription: 1,
			dateUpdated: 1,
			dateAdded: 1,
			addedBy: 1,
			updatedBy: 1
		});
	},
	// We want to specifically get these types
	getForProjectType: function (projectid, type) {
		return this.list({project: projectid, typeCode: type},
		{
			name: 1,
			version: 1,
			stage: 1,
			isPublished: 1,
			userPermissions: 1,
			valuedComponents: 1,
			author: 1,
			shortDescription: 1,
			dateUpdated: 1,
			dateAdded: 1,
			addedBy: 1,
			updatedBy: 1
		});
	},
	// -------------------------------------------------------------------------
	//
	// make a new artifact from a given type.
	// this will make the new artifact and put it in the first stage and the
	// first version as supplied in the type model
	// if it is of type template, then the most current version of the template
	// that matches the type will be used
	//
	// -------------------------------------------------------------------------
	newFromType: function (code, project) {
		var types = new ArtifactType(this.opts);
		var template = new Template(this.opts);
		var self = this;
		var artifactType;
		var artifact;
		var prefix = 'Add Artifact Error: ';
		return new Promise(function (resolve, reject) {
			//
			// first off, lets check and make sure that we have everything we need
			// in order to continue
			//
			// console.log ('project: ',JSON.stringify (project, null, 4));
			if (!project) return reject(new Error(prefix + 'missing project'));
			if (!project.currentPhase) return reject(new Error(prefix + 'missing current phase'));
			//
			// default a new artifact
			//
			self.newDocument().then(function (a) {
				artifact = a;
				return types.findOne({code: code});
			})
			//
			// check that we have an artifact type
			//
			.then(function (atype) {
				if (!atype) return reject(new Error(prefix + 'cannot locate artifact type'));
				else {
					artifactType = atype;
					// console.log ('getting template');
					//
					// if this is a template artifact get the latest version of the template
					//
					if (artifactType.isTemplate) return template.findFirst({code: code}, null, {versionNumber: -1});
				}
			})
			//
			// if template, check that have it as well
			//
			.then(function (t) {
				// console.log ('setting template');
				//
				// if its a template, but the template was not found then fail
				//
				if (artifactType.isTemplate && !t) return reject(prefix + 'cannot find template');
				//
				// otherwise set the template if required and retun the artifact for next step
				//
				else {
					artifact.template = (artifactType.isTemplate) ? t[0] : null;
					artifact.isTemplate = artifactType.isTemplate;
					artifact.isArtifactCollection = artifactType.isArtifactCollection;
					return artifact;
				}
			})
			//
			// now add the milestone associated with this artifact
			//
			.then(function (m) {
				// console.log("artifact type:",artifactType);
				// Don't add milestones for artifacts of type 'valued-component'
				if (artifactType.code === 'valued-component') {
					return null;
				}

				// not sure if this is right or we need more data on the templates...
				if (_.isEmpty(artifactType.milestone))
					return null;

				var p = new MilestoneClass(self.opts);
				return p.fromBase(artifactType.milestone, project.currentPhase);
			})
			//
			// now set up and save the new artifact
			//
			.then(function (milestone) {
				//console.log('newFromType milestone ' + JSON.stringify(milestone, null, 4));
				// Happens when we skip adding a milestone.
				if (milestone) {
					artifact.milestone = milestone._id;
				}
				artifact.typeCode = artifactType.code;
				artifact.name = artifactType.name;
				artifact.project = project._id;
				artifact.phase = project.currentPhase._id;
				artifact.artifactType = artifactType;
				artifact.version = artifactType.versions[0];
				artifact.stage = artifactType.stages[0].name;
				return artifact;
			})
			.then(function(a) {
				// should maybe get defaults for the artifact type to apply here?
				// or ???
				return Access.getPermissionRoles({resource: project._id});
			})
			.then(function(res) {
				artifact.read = res.listArtifacts;
				artifact.write = res.createArtifact;
				artifact.delete = res.createArtifact;
				
				return self.setDefaultRoles(artifact, project, artifactType.code);
			})
			.then(function(a) {
				//console.log('newFromType call saveDocument');
				return self.saveDocument(artifact);
			})
			.then(function(a) {
				//console.log('newFromType saveDocument returns: ' + JSON.stringify(a, null, 4));
				return a;
			})
			.then(resolve, reject);
		});
	},
	setDefaultRoles: function (artifact, project, type) {
		// Set default read/write/submit permissions on artifacts based on their type.
		// console.log("setting default roles for: ", type);
		if (type === 'valued-component') {
			artifact.read.push("eao-admin");
			artifact.read.push("eao-member");
			artifact.read.push("intake");
			artifact.read.push("assistant-dm");
			artifact.read.push("associate-dmo");
			artifact.read.push("minister");
			artifact.read.push("qa-officer");
			artifact.read.push("ce-lead");
			artifact.read.push("ce-officer");
			artifact.write.push("pro-admin");
			artifact.write.push("pro-member");
			artifact.write.push("team");
			artifact.write.push("lead");
			artifact.write.push("epd");
		} else if (_.startsWith(type, 'section-10')) {
			artifact.read.push("team");
			artifact.write.push("epd");
			artifact.write.push("lead");
		} else if (_.startsWith(type, 'section-6') || _.startsWith(type, 'section-7') || _.startsWith(type, 'section-11') || _.startsWith(type, 'section-34') || _.startsWith(type, 'section-36')) {
			artifact.write.push("ce-lead");
			artifact.write.push("ce-officer");
		} else if (type === 'application') {
			artifact.write.push("pro-admin");
			artifact.write.push("pro-member");
			artifact.write.push("pro-subconsultant");
			artifact.write.push("epd");
			artifact.write.push("lead");
			artifact.write.push("team");
		} else if (type === 'decision-package') {
			artifact.write.push("epd");
			artifact.read.push("lead");
			artifact.read.push("team");
		} else if (type === 'referral-package') {
			artifact.write.push("epd");
			artifact.read.push("lead");
			artifact.read.push("team");
		} else if (type === 'environmental-assessment-certificate' || type === 'certificate') {
			artifact.write.push("epd");
			artifact.write.push("lead");
			artifact.read.push("team");
			artifact.read.push("ce-lead");
			artifact.read.push("ce-officer");
		} else if (type === 'inspection-report') {
			artifact.write.push("ce-lead");
			artifact.write.push("ce-officer");
		}
		return artifact;
	},
	// -------------------------------------------------------------------------
	//
	// return a list of avaible types based upon the table, but also what the
	// project already has.  So, any artifaacts that can only appear once,
	// such as the project description, cannot be returned if they have already
	// been established within the project
	//
	// -------------------------------------------------------------------------
	availableTypes: function (projectId) {
		//
		// get a list of all multiple types, those can be used
		// get a list of non-multiples
		// get a list of already used types in the project
		// get the disjoint of the latter two and add those to the list of available
		//
		var self = this;
		var Types = new ArtifactType(self.opts);
		var multiples = [];
		var nonmultiples = [];
		return new Promise(function (resolve, reject) {
			Types.getMultiples()
			.then(function (result) {
				// console.log (result);
				if (result) multiples = result;
				// console.log ('multiples = ', JSON.stringify(multiples,null,4));
			})
			.then(Types.getNonMultiples)
			.then(function (result) {
				// console.log (result);
				if (result) nonmultiples = result;
				// console.log ('non-multiples = ', JSON.stringify(nonmultiples,null,4));
				return projectId;
			})
			.then(self.getCurrentTypes)
			.then(function (currenttypes) {
				var allowed = [];
				if (currenttypes) {
					_.each(nonmultiples, function (val) {
						if (!~currenttypes.indexOf(val.code)) {
							allowed.push(val);
						}
					});
					// Add in the multiples
					_.each(multiples, function (item) {
						allowed.push(item);
					});
				}
				// console.log ('nallowed = ', JSON.stringify(allowed,null,4));
				return allowed;
			})
			.then(resolve, reject);
		});
	},
	// -------------------------------------------------------------------------
	//
	// get all the current types used for a project
	//
	// -------------------------------------------------------------------------
	getCurrentTypes: function (projectId) {
		// console.log ('getCurrentTypes for ', projectId);
		var self = this;
		return new Promise(function (resolve, reject) {
			self.findMany({project: projectId}, {typeCode: 1})
			.then(function (result) {
				return result.map(function (e) {
					return e.typeCode;
				});
			})
			.then(resolve, reject);
		});
	},
	// -------------------------------------------------------------------------
	//
	// these save the passed in document and then progress it to the next stage
	// doc is a json object while oldDoc is a proper mongoose schema
	//
	// -------------------------------------------------------------------------
	nextStage: function (doc, oldDoc) {
		var stage = _.find(doc.artifactType.stages, function (s) {
			return s.name === doc.stage;
		});
		if (stage.next) {
			var next = _.find(doc.artifactType.stages, function (s) {
				return s.name === stage.next;
			});
			return this.newStage(doc, oldDoc, next);
		}
	},
	prevStage: function (doc, oldDoc) {
		var stage = _.find(doc.artifactType.stages, function (s) {
			return s.name === doc.stage;
		});
		if (stage.prev) {
			var prev = _.find(doc.artifactType.stages, function (s) {
				return s.name === stage.prev;
			});
			return this.newStage(doc, oldDoc, prev);
		}
	},
	newStage: function (doc, oldDoc, next) {
		doc.stage = next.name;
		// console.log (doc);
		// console.log (doc.reviewnote);
		//
		// if there is a new review note then push it
		//
		if (doc.reviewnote) {
			doc.reviewNotes.push({
				username: this.user.username,
				date: Date.now(),
				note: doc.reviewnote
			});
		}
		//
		// if there is a new approval note then push it
		//
		if (doc.approvalnote) {
			doc.approvalNotes.push({
				username: this.user.username,
				date: Date.now(),
				note: doc.approvalnote
			});
		}
		//
		// if there is a new decision note then push it
		//
		if (doc.decisionnote) {
			doc.decisionNotes.push({
				username: this.user.username,
				date: Date.now(),
				note: doc.decisionnote
			});
		}
		//
		// if this is a publish step, then publish the artifact
		//
		// doc.read = _.union (doc.read, 'public');
		// doc.isPublished = true;
		//
		// save the document
		//
		// console.log ('about to attempt to save saveDocument', doc);
		if (_.isEmpty(doc.document)) doc.document = null;
		var p = this.update(oldDoc, doc);
		var self = this;
		return new Promise(function (resolve, reject) {
			//
			// once saved go and create the new activity if one is listed under
			// this stage
			//
			p.then(function (model) {
				// console.log ('document saved, now add the activity ', model.milestone, next.activity);
				if (model.milestone && next.activity) {
					var ativity;
					var m = new MilestoneClass(self.opts);
					var a = new ActivityClass(self.opts);
					return m.findById(model.milestone)
					.then(function (milestone) {
						// console.log ('found the milestone, now adding attivity');
						//
						// this is where we should/would set special permisions, but they
						// really should be on the default base activity (which this does do)
						//
						return a.fromBase(next.activity, milestone, {artifactId: model._id});
					})
					.then(function () {
						return model;
					});
				} else {
					return model;
				}
			})
			.then(resolve, reject);
		});
	},
	// -------------------------------------------------------------------------
	//
	// this gets the most current version of each artifact
	//
	// -------------------------------------------------------------------------
	currentArtifacts: function () {
		var self = this;
		return new Promise(function (resolve, reject) {
			self.model.aggregate([
				{"$sort": {"versionNumber": -1}},
				{
					"$group": {
						"_id": "$typeCode",
						"id": {"$first": "$_id"},
						"name": {"$first": "$name"},
						"documentType": {"$first": "$typeCode"},
						"versionNumber": {"$first": "$versionNumber"},
						"dateUpdated": {"$first": "$dateUpdated"},
						"stage": {"$first": "$stage"}
					}
				}
			], function (err, result) {
				if (err) return reject(err);
				else resolve(result);
			});
		});
	},
	// -------------------------------------------------------------------------
	//
	// create a new version of the supplied artifact in the passed in project
	// in its current phase.
	//
	// -------------------------------------------------------------------------
	createNewArtifactInProject: function (type, project) {

	},
	// -------------------------------------------------------------------------
	//
	// for the given artifact, assumed already created in a base form, create
	// the initial activity set using the milestonebase attached to the artifact
	// meta
	//
	// -------------------------------------------------------------------------
	createMilestoneForArtifact: function (artifact) {

	},
	// -------------------------------------------------------------------------
	//
	// publish / unpublish
	//
	// -------------------------------------------------------------------------
	publish: function (artifact) {
		var documentClass = new DocumentClass(this.opts);
		return new Promise(function (resolve, reject) {
			artifact.publish();
			artifact.save()
				.then(function () {
					// publish document, additionalDocuments, supportingDocuments
					//console.log('documentClass.publish(artifact.document): ' + JSON.stringify(artifact.document, null, 4));
					return documentClass.publish(artifact.document);
				})
				.then(function () {
					return documentClass.getListIgnoreAccess(artifact.additionalDocuments);
				})
				.then(function (list) {
					//console.log('documentClass.publishList(artifact.additionalDocuments): ' + JSON.stringify(list, null, 4));
					var a = _.forEach(list, function (d) {
						return new Promise(function (resolve, reject) {
							resolve(documentClass.publish(d));
						});
					});
					return Promise.all(a);
				})
				.then(function () {
					return documentClass.getListIgnoreAccess(artifact.supportingDocuments);
				})
				.then(function (list) {
					//console.log('documentClass.publishList(artifact.supportingDocuments): ' + JSON.stringify(list, null, 4));
					var a = _.forEach(list, function (d) {
						return new Promise(function (resolve, reject) {
							resolve(documentClass.publish(d));
						});
					});
					return Promise.all(a);
				})
				.then(function () {
					return documentClass.getListIgnoreAccess(artifact.internalDocuments);
				})
				.then(function (list) {
					//console.log('documentClass.unpublishList(artifact.internalDocuments): ' + JSON.stringify(list, null, 4));
					var a = _.forEach(list, function (d) {
						return new Promise(function (resolve, reject) {
							resolve(documentClass.unpublish(d));
						});
					});
					return Promise.all(a);
				})
				.then(function () {
					//console.log('< save()');
					return artifact;
				})
				.then(resolve, reject);
		});
	},
	unpublish: function (artifact) {
		var documentClass = new DocumentClass(this.opts);
		return new Promise(function (resolve, reject) {
			artifact.unpublish();
			artifact.save()
				.then(function () {
					// publish document, additionalDocuments, supportingDocuments
					//console.log('documentClass.unpublish(artifact.document): ' + JSON.stringify(artifact.document, null, 4));
					return documentClass.unpublish(artifact.document);
				})
				.then(function () {
					return documentClass.getListIgnoreAccess(artifact.additionalDocuments);
				})
				.then(function (list) {
					//console.log('documentClass.unpublishList(artifact.additionalDocuments): ' + JSON.stringify(list, null, 4));
					var a = _.forEach(list, function (d) {
						return new Promise(function (resolve, reject) {
							resolve(documentClass.unpublish(d));
						});
					});
					return Promise.all(a);
				})
				.then(function () {
					return documentClass.getListIgnoreAccess(artifact.supportingDocuments);
				})
				.then(function (list) {
					//console.log('documentClass.unpublishList(artifact.supportingDocuments): ' + JSON.stringify(list, null, 4));
					var a = _.forEach(list, function (d) {
						return new Promise(function (resolve, reject) {
							resolve(documentClass.unpublish(d));
						});
					});
					return Promise.all(a);
				})
				.then(function () {
					return documentClass.getListIgnoreAccess(artifact.internalDocuments);
				})
				.then(function (list) {
					//console.log('documentClass.unpublishList(artifact.internalDocuments): ' + JSON.stringify(list, null, 4));
					var a = _.forEach(list, function (d) {
						return new Promise(function (resolve, reject) {
							resolve(documentClass.unpublish(d));
						});
					});
					return Promise.all(a);
				})
				.then(function () {
					//console.log('< save()');
					return artifact;
				})
				.then(resolve, reject);
		});
	}
});
