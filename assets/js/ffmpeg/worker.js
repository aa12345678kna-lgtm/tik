import { CORE_URL, FFMessageType } from "./const.js";
import {
  ERROR_UNKNOWN_MESSAGE_TYPE,
  ERROR_NOT_LOADED,
  ERROR_IMPORT_FAILURE,
} from "./errors.js";

let ffmpeg;

const load = async ({ coreURL: inputCoreURL, wasmURL: inputWasmURL, workerURL: inputWorkerURL }) => {
  let coreURL = inputCoreURL;
  const first = !ffmpeg;
  try {
    if (!coreURL) coreURL = CORE_URL;
    importScripts(coreURL);
  } catch {
    if (!inputCoreURL) coreURL = CORE_URL.replace("/umd/", "/esm/");
    self.createFFmpegCore = (await import(/* @vite-ignore */ coreURL)).default;
    if (!self.createFFmpegCore) throw ERROR_IMPORT_FAILURE;
  }
  const wasmURL = inputWasmURL || coreURL.replace(/.js$/g, ".wasm");
  const workerURL = inputWorkerURL || coreURL.replace(/.js$/g, ".worker.js");
  ffmpeg = await self.createFFmpegCore({
    mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL, workerURL }))}`,
  });
  ffmpeg.setLogger(data => self.postMessage({ type: FFMessageType.LOG, data }));
  ffmpeg.setProgress(data => self.postMessage({ type: FFMessageType.PROGRESS, data }));
  return first;
};

const exec = ({ args, timeout = -1 }) => {
  ffmpeg.setTimeout(timeout);
  ffmpeg.exec(...args);
  const ret = ffmpeg.ret;
  ffmpeg.reset();
  return ret;
};
const writeFile = ({ path, data }) => (ffmpeg.FS.writeFile(path, data), true);
const readFile = ({ path, encoding }) => ffmpeg.FS.readFile(path, { encoding });
const deleteFile = ({ path }) => (ffmpeg.FS.unlink(path), true);
const rename = ({ oldPath, newPath }) => (ffmpeg.FS.rename(oldPath, newPath), true);
const createDir = ({ path }) => (ffmpeg.FS.mkdir(path), true);
const listDir = ({ path }) => ffmpeg.FS.readdir(path).map(name => {
  const stat = ffmpeg.FS.stat(`${path}/${name}`);
  return { name, isDir: ffmpeg.FS.isDir(stat.mode) };
});
const deleteDir = ({ path }) => (ffmpeg.FS.rmdir(path), true);
const mount = ({ fsType, options, mountPoint }) => {
  const fs = ffmpeg.FS.filesystems[fsType];
  if (!fs) return false;
  ffmpeg.FS.mount(fs, options, mountPoint);
  return true;
};
const unmount = ({ mountPoint }) => (ffmpeg.FS.unmount(mountPoint), true);

self.onmessage = async ({ data: { id, type, data: payload } }) => {
  const transfer = [];
  let result;
  try {
    if (type !== FFMessageType.LOAD && !ffmpeg) throw ERROR_NOT_LOADED;
    switch (type) {
      case FFMessageType.LOAD: result = await load(payload); break;
      case FFMessageType.EXEC: result = exec(payload); break;
      case FFMessageType.WRITE_FILE: result = writeFile(payload); break;
      case FFMessageType.READ_FILE: result = readFile(payload); break;
      case FFMessageType.DELETE_FILE: result = deleteFile(payload); break;
      case FFMessageType.RENAME: result = rename(payload); break;
      case FFMessageType.CREATE_DIR: result = createDir(payload); break;
      case FFMessageType.LIST_DIR: result = listDir(payload); break;
      case FFMessageType.DELETE_DIR: result = deleteDir(payload); break;
      case FFMessageType.MOUNT: result = mount(payload); break;
      case FFMessageType.UNMOUNT: result = unmount(payload); break;
      default: throw ERROR_UNKNOWN_MESSAGE_TYPE;
    }
  } catch (error) {
    self.postMessage({ id, type: FFMessageType.ERROR, data: String(error) });
    return;
  }
  if (result instanceof Uint8Array) transfer.push(result.buffer);
  self.postMessage({ id, type, data: result }, transfer);
};
