export * from './castes';
export * from './rig';
export { RHYNCHOTERMES_CASTES } from './castes-rhynchotermes';
export { buildTermiteGeometry, buildEggClusterGeometry } from './build';
export {
  termiteTime,
  termiteRigTexture,
  registerTermiteRig,
  termiteBodyPatch,
  termiteShellPatch,
  termiteDepthPatch,
  applyPatch,
  getTermiteMaterial,
  getTermiteGlueShellMaterial,
  getTermiteDepthMaterial,
  TermiteInstances,
  gaitRateForSpeed,
  computeAim,
  nasusTipLocal,
  // v2: Sickle-Jaw grab-and-squirt
  holdTug,
  mandibleSocketLocal,
  holdNasusTipLocal,
  heldVictimTransform,
  holdAimOffset,
  holdAimAt,
  solveHoldOnVictim,
  solveFreeSquirt,
  victimStruggle,
} from './material';
export type { StateOptions, ShaderPatch, HoldPoseInput } from './material';
export { GlueStreams, ACID_STREAM, createGlueShellMaterial, glueShellPatch, glueBurstOffsets, acidShellPatch, createAcidShellMaterial, AcidFizz } from './glue';
export type { GlueStreamOptions } from './glue';
export { createCartonMaterial, cartonPatch, buildGalleryTubeGeometry } from './carton';
export { createDampSoilMaterial, dampSoilPatch, dampSoilUniforms, buildLeafLitterGeometry, createLeafLitterMaterial } from './soil';
export { bakeTermiteImpostor, TermiteImpostors } from './impostor';
export type { ImpostorAtlas } from './impostor';
export { SickleJawAudio, SICKLE_AUDIO_EVENTS } from './audio';
export type { SickleAudioEvent } from './audio';
