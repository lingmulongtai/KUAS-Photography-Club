"use strict";
// Upstream 0.3.1 publishes these modules alongside its bundled entry point.
// Re-export them so they resolve the patched Zod declared in package.json.
Reflect.defineProperty(exports, "__esModule", { value: true });
const modules = [require("./types"), require("./schema"), require("./cli-config"), require("./cred-storage")];
for (const source of modules) {
  for (const key of Object.keys(source)) {
    if (key !== "default" && !Object.prototype.hasOwnProperty.call(exports, key)) {
      Object.defineProperty(exports, key, { enumerable: true, get: () => source[key] });
    }
  }
}
// Preserve Node's static discovery of the upstream CommonJS named exports.
0 && (module.exports = { CRED_STORAGE_CONFIG_VALUES, CRED_STORAGE_VALUES, DEFAULT_CRED_STORAGE, authConfigHasUsableTokenData, authConfigSchema, credStorageSchema, defaultAuthConfig, defaultGlobalConfig, deleteAuthConfig, deleteAuthConfigFile, getAuthConfigFilePath, getCachePath, getConfigFilePath, getDataPath, getDefaultAuthConfig, getGlobalPathConfig, getLikelyEffectiveCredStorage, globalConfigSchema, guidanceConfigSchema, parseAuthConfig, parseAuthFileConfig, parseGlobalConfig, readAuthConfig, readAuthConfigFile, readAuthFileConfig, readConfigFile, readGlobalConfigFile, telemetryConfigSchema, tryReadAuthConfig, updatesConfigSchema, writeAuthConfig, writeAuthConfigFile, writeConfigFile, writeGlobalConfigFile });
