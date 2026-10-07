import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import logger from './logger.js';

export const DEFAULT_EVENT_PROFILE = 'lifestyle';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedConfig = null;

/**
 * Load and parse a YAML file, returning null if it doesn't exist.
 * @param {string} filePath - Absolute path to the YAML file
 * @returns {object|null}
 */
const loadOptionalYaml = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  try {
    return yaml.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    logger.warn(`Could not parse YAML file ${filePath}: ${err.message}`);
    return null;
  }
};

/**
 * Resolve the profile directory from environment variables.
 * Returns { profileDir, configPath } where configPath is the main profile.yaml.
 */
const resolveProfileDir = () => {
  let configPath = process.env.EVENT_PROFILE_PATH;

  if (configPath) {
    // Explicit path — resolve relative to cwd, derive directory from it
    configPath = path.resolve(process.cwd(), configPath);
    return { profileDir: path.dirname(configPath), configPath };
  }

  const profileName = process.env.EVENT_PROFILE || DEFAULT_EVENT_PROFILE;
  const repoDir = path.resolve(process.cwd(), 'profiles', profileName);
  const repoPath = path.join(repoDir, 'profile.yaml');
  const bundledPath = path.resolve(__dirname, 'profile.yaml');

  if (fs.existsSync(repoPath)) {
    return { profileDir: repoDir, configPath: repoPath };
  } else if (fs.existsSync(bundledPath)) {
    return { profileDir: __dirname, configPath: bundledPath };
  }

  // Fallback for error reporting
  return { profileDir: repoDir, configPath: repoPath };
};

const mergeSplitYamlFiles = (config, profileDir) => {
  const rulesFile = loadOptionalYaml(path.join(profileDir, 'rules.yaml'));
  if (rulesFile?.rules) {
    if (config.rules && config.rules.length > 0) {
      logger.warn(
        'Profile has rules in both profile.yaml and rules.yaml — rules.yaml takes precedence'
      );
    }
    config.rules = rulesFile.rules;
  }

  const stickersFile = loadOptionalYaml(path.join(profileDir, 'stickers.yaml'));
  if (stickersFile?.stickers) {
    if (config.stickers && Object.keys(config.stickers).length > 0) {
      logger.warn(
        'Profile has stickers in both profile.yaml and stickers.yaml — stickers.yaml takes precedence'
      );
    }
    config.stickers = stickersFile.stickers;
  }

  const demoSeedsFile = loadOptionalYaml(path.join(profileDir, 'demo_seeds.yaml'));
  if (demoSeedsFile) {
    if (config.demo_seeds) {
      logger.warn(
        'Profile has demo_seeds in both profile.yaml and demo_seeds.yaml — demo_seeds.yaml takes precedence'
      );
    }
    config.demo_seeds = demoSeedsFile;
  } else if (!config.demo_seeds) {
    config.demo_seeds = null;
  }
};

export const getEventProfile = () => {
  if (cachedConfig) {
    return cachedConfig;
  }

  const { profileDir, configPath } = resolveProfileDir();

  let fileContents;
  try {
    fileContents = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    console.error(`Failed to read event profile config at ${configPath}:`, err.message);
    throw err;
  }

  const config = yaml.parse(fileContents);

  mergeSplitYamlFiles(config, profileDir);

  // --- Defaults for missing optional keys ---
  if (!config.rules) {
    config.rules = [];
  }

  if (!config.contact_methods) {
    config.contact_methods = ['Phone', 'Email'];
  }

  cachedConfig = config;
  return config;
};

export const getDomainConfig = getEventProfile;

export const clearConfigCache = () => {
  cachedConfig = null;
};
