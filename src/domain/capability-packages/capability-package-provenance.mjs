// @ts-check

import { CAPABILITY_PACKAGE_PROVENANCE_SCHEMA_VERSION } from './capability-package-schema.mjs';

function cleanText(value, fallback = 'unknown') {
  return String(value ?? fallback).trim().replace(/\s+/gu, ' ').slice(0, 240) || fallback;
}

export function createCapabilityPackageProvenance(graph = {}, options = {}) {
  return {
    schemaVersion: CAPABILITY_PACKAGE_PROVENANCE_SCHEMA_VERSION,
    compiledAt: cleanText(options.compiledAt ?? graph.manifest?.compiledAt, 'unknown'),
    compilerVersion: cleanText(options.compilerVersion ?? graph.manifest?.compilerVersion, 'unknown'),
    sourceDigest: cleanText(options.sourceDigest ?? graph.manifest?.sourceDigest, ''),
    graphDigest: cleanText(options.graphDigest, ''),
    graphVersion: cleanText(graph.graphVersion, ''),
    material: 'descriptor_only',
  };
}
