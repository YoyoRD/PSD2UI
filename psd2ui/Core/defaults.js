'use strict';

const PRESET_VERSION = 1;
const ENABLED = 'enabled';
const DISABLED = 'disabled';

function color(r, g, b, a) {
  return { r, g, b, a };
}

function createPreset(semantic) {
  const common = {
    presetVersion: PRESET_VERSION,
    authoringSource: 'explicit',
    exportMode: 'runtime',
    structure: null,
    visible: ENABLED,
    opacity: 1,
    rotationClockwiseDegrees: 0
  };

  switch (semantic) {
    case 'view':
    case 'group':
      return { ...common, semantic };
    case 'ignore':
      return { ...common, semantic, ignoreMode: 'subtree' };
    case 'image':
      return {
        ...common,
        semantic,
        image: {
          resourceId: null,
          imageType: 'simple',
          sliceBorder: null,
          preserveAspect: DISABLED,
          raycast: DISABLED,
          color: color(1, 1, 1, 1)
        }
      };
    case 'raw-image':
      return {
        ...common,
        semantic,
        rawImage: {
          resourceId: null,
          uvRect: { x: 0, y: 0, width: 1, height: 1 },
          raycast: DISABLED,
          color: color(1, 1, 1, 1)
        }
      };
    case 'text':
      return {
        ...common,
        semantic,
        text: {
          fontKey: 'default',
          effects: null,
          value: '',
          fontSize: 24,
          color: color(1, 1, 1, 1),
          alignment: 'middle-center',
          richText: ENABLED,
          raycast: DISABLED,
          lineSpacing: 1
        }
      };
    case 'button':
      return {
        ...common,
        semantic,
        button: {
          interactable: ENABLED,
          transition: 'color-tint'
        }
      };
    case 'input-field':
    case 'toggle':
    case 'list':
    case 'grid':
    case 'red-point':
    case 'toggle-page-group':
    case 'list-page-group':
      return { ...common, semantic };
    default:
      return null;
  }
}

module.exports = {
  PRESET_VERSION,
  ENABLED,
  DISABLED,
  createPreset
};
