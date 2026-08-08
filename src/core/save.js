// localStorage persistence. Never throws — a browser with storage disabled
// just plays without saving.

const KEY = 'weg-des-ritters/save';
const SETTINGS = 'weg-des-ritters/settings';

export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    return false;
  }
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    /* ignore */
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS, JSON.stringify(s));
  } catch (e) {
    /* ignore */
  }
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}
