// @ts-check

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { resolveProfileSchema } from '../schema/profile-schemas.mjs';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function joinPath(basePath, segment) {
  if (typeof segment === 'number') {
    return `${basePath}[${segment}]`;
  }
  return basePath ? `${basePath}.${segment}` : segment;
}

function pushError(errors, at, message) {
  errors.push({ path: at, message });
}

function validateAgainstSchema(value, schema, at, errors) {
  if (!schema) {
    return;
  }

  if (value === undefined) {
    pushError(errors, at, 'is required');
    return;
  }

  switch (schema.type) {
    case 'object': {
      if (!isPlainObject(value)) {
        pushError(errors, at, 'must be an object');
        return;
      }
      const required = schema.required ?? [];
      for (const key of required) {
        if (!(key in value)) {
          pushError(errors, joinPath(at, key), 'is required');
        }
      }
      const properties = schema.properties ?? {};
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(key in properties)) {
            pushError(errors, joinPath(at, key), 'is not allowed');
          }
        }
      }
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (key in value) {
          validateAgainstSchema(value[key], propertySchema, joinPath(at, key), errors);
        }
      }
      break;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        pushError(errors, at, 'must be an array');
        return;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        pushError(errors, at, `must contain at least ${schema.minItems} item(s)`);
      }
      for (let index = 0; index < value.length; index += 1) {
        validateAgainstSchema(value[index], schema.items, joinPath(at, index), errors);
      }
      break;
    }
    case 'integer': {
      if (!Number.isInteger(value)) {
        pushError(errors, at, 'must be an integer');
        return;
      }
      if (schema.min !== undefined && value < schema.min) {
        pushError(errors, at, `must be greater than or equal to ${schema.min}`);
      }
      break;
    }
    case 'string': {
      if (typeof value !== 'string') {
        pushError(errors, at, 'must be a string');
        return;
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        pushError(errors, at, `must be at least ${schema.minLength} character(s) long`);
      }
      if (schema.const !== undefined && value !== schema.const) {
        pushError(errors, at, `must equal ${JSON.stringify(schema.const)}`);
      }
      break;
    }
    default:
      pushError(errors, at, `uses unsupported schema type ${JSON.stringify(schema.type)}`);
      return;
  }

  if (typeof schema.validate === 'function') {
    const outcome = schema.validate(value);
    const messages = Array.isArray(outcome) ? outcome : outcome ? [outcome] : [];
    for (const message of messages) {
      pushError(errors, at, message);
    }
  }
}

function formatValidationMessage(targetLabel, errors) {
  const detail = errors.map((entry) => `- ${entry.path}: ${entry.message}`).join('\n');
  return `Invalid profile ${targetLabel}\n${detail}`;
}

export class ProfileValidationError extends Error {
  constructor(targetLabel, errors) {
    super(formatValidationMessage(targetLabel, errors));
    this.name = 'ProfileValidationError';
    this.errors = errors;
  }
}

export function validateProfileObject(profile, options = {}) {
  const { expectedHost, source = 'profile object' } = options;
  const errors = [];

  if (!isPlainObject(profile)) {
    throw new ProfileValidationError(source, [{ path: 'profile', message: 'must be an object' }]);
  }

  const declaredHost = typeof profile.host === 'string' ? profile.host : null;
  const schemaHost = expectedHost ?? declaredHost;

  if (!declaredHost) {
    pushError(errors, 'profile.host', 'is required');
  } else if (expectedHost && declaredHost !== expectedHost) {
    pushError(errors, 'profile.host', `must match file name host ${JSON.stringify(expectedHost)}`);
  }

  if (!schemaHost) {
    pushError(errors, 'profile.host', 'is required to resolve a schema');
  }

  const schema = schemaHost ? resolveProfileSchema(schemaHost) : null;
  if (!schema && schemaHost) {
    pushError(errors, 'profile.host', `has no registered schema for ${JSON.stringify(schemaHost)}`);
  }

  if (schema) {
    validateAgainstSchema(profile, schema, 'profile', errors);
  }

  if (errors.length) {
    throw new ProfileValidationError(source, errors);
  }

  return {
    valid: true,
    host: schemaHost,
    schemaId: schema?.id ?? null,
    profile,
  };
}

export async function validateProfileFile(profilePath, options = {}) {
  const resolvedPath = path.resolve(profilePath);
  const source = options.source ?? resolvedPath;
  const raw = await readFile(resolvedPath, 'utf8');

  let profile;
  try {
    profile = JSON.parse(raw);
  } catch (error) {
    throw new ProfileValidationError(source, [{
      path: 'profile',
      message: `contains invalid JSON: ${error?.message ?? String(error)}`,
    }]);
  }

  const expectedHost = options.expectedHost ?? path.basename(resolvedPath, path.extname(resolvedPath));
  const result = validateProfileObject(profile, {
    ...options,
    expectedHost,
    source,
  });

  return {
    ...result,
    filePath: resolvedPath,
    raw,
  };
}
