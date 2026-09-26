'use strict';

const versionMajors = { 'Photoshop.Application.140': 21, 'Photoshop.Application.190': 26 };

function parseSessionOptions(args) {
  let output, progId = 'Photoshop.Application';
  let explicitProgId = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--prog-id') {
      if (explicitProgId || !Object.hasOwn(versionMajors, args[index + 1])) {
        throw new Error('--prog-id requires Photoshop.Application.140 (PS 2020) or Photoshop.Application.190 (PS 2025), once.');
      }
      progId = args[++index]; explicitProgId = true;
    } else if (argument.startsWith('--') || output != null) {
      throw new Error('Usage: node verify-cep-session.js [output-directory] [--prog-id Photoshop.Application.140|Photoshop.Application.190]');
    } else output = argument;
  }
  return { output, progId, expectedVersionMajor: versionMajors[progId] || 0 };
}

function verifySessionIdentity(options, identity) {
  if (!identity || identity.type !== 'ready' || identity.progId !== options.progId
      || !/^\d+(?:\.\d+)*$/.test(identity.photoshopVersion || '') || !identity.photoshopPath) {
    throw new Error('Photoshop bridge did not identify the requested running application.');
  }
  if (options.expectedVersionMajor && Number(identity.photoshopVersion.split('.')[0]) !== options.expectedVersionMajor) {
    throw new Error(`Photoshop version mismatch: ${options.progId} returned ${identity.photoshopVersion}; expected major ${options.expectedVersionMajor}.`);
  }
  return identity;
}

module.exports = { parseSessionOptions, verifySessionIdentity };
