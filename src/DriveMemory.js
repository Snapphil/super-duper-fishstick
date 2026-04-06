/**
 * HERMES — DriveMemory.gs
 * ============================================
 * PANTHEON SYSTEM: Low-Level VAULT Operations
 * 
 * Direct Google Drive file I/O helpers.
 */

const _fileCache = {};

function clearMemoryCache_() {
  for (const k of Object.keys(_fileCache)) delete _fileCache[k];
}

function readMemory(propKey) {
  if (_fileCache[propKey]) return _fileCache[propKey];
  
  const fieldId = getProp(propKey);
  if (!fieldId) return null;
  
  try {
    const content = DriveApp.getFileById(fieldId).getBlob().getDataAsString();
    _fileCache[propKey] = content;
    return content;
  } catch (e) {
    console.error(`Read error ${propKey}: ${e.message}`);
    return null;
  }
}

function readJson(propKey) {
  const raw = readMemory(propKey);
  if (!raw) return null;
  return safeJsonParse(raw);
}

function writeMemory(propKey, content) {
  const fieldId = getProp(propKey);
  if (!fieldId) { console.error(`No File ID for ${propKey}`); return; }
  
  try {
    DriveApp.getFileById(fieldId).setContent(content);
    _fileCache[propKey] = content;
  } catch (e) {
    console.error(`Write error ${propKey}: ${e.message}`);
  }
}

function writeJson(propKey, data) {
  writeMemory(propKey, JSON.stringify(data, null, 2));
}

function appendJsonArray(propKey, entry) {
  let arr = readJson(propKey);
  if (!Array.isArray(arr)) arr = [];
  arr.push(entry);
  writeJson(propKey, arr);
}

// ============ FOLDER HELPERS ============

function mkdirp_(name, parent) {
  const search = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (search.hasNext()) return search.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

function mkfile_(propKey, name, folder, content) {
  const existing = folder.getFilesByName(name);
  let file;
  if (existing.hasNext()) {
    file = existing.next();
  } else {
    file = folder.createFile(name, content);
  }
  setProp(propKey, file.getId());
  return file;
}