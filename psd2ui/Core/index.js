'use strict';

const commands = require('./authoringCommands');
const registry = require('./resourceRegistry');
const validation = require('./validation');
const bundle = require('./bundle');
const errors = require('./errors');
const structure = require('./structure');
const selection = require('./selection');
const snapshot = require('./snapshot');
const nineSlice = require('./nineSlice');
const naming = require('./naming');

module.exports = {
  ...commands,
  ...registry,
  ...validation,
  ...bundle,
  ...errors,
  ...structure,
  ...selection,
  ...snapshot,
  ...nineSlice,
  ...naming
};
